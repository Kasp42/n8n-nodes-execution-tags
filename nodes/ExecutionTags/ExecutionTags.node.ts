import {
	ICredentialsDecrypted,
	ICredentialTestFunctions,
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	JsonObject,
	INodeCredentialTestResult,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
} from 'n8n-workflow';

type TagRef = { id: string; name?: string };

type ErrorContext = { baseUrl: string; executionId: string; tagsBy: string };

// Turns raw API errors into messages a human can act on
function explainError(error: unknown, ctx: ErrorContext): { message: string; description: string } | undefined {
	const err = error as { message?: string; httpCode?: string | number; description?: string };
	const raw = `${err.message ?? ''} ${err.description ?? ''}`;
	const status = Number(err.httpCode ?? /status code (\d{3})/.exec(raw)?.[1] ?? 0);

	if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|certificate/i.test(raw)) {
		return {
			message: `Cannot reach n8n at ${ctx.baseUrl}`,
			description:
				'Check the Base URL in the Execution Tags API credential (leave it empty to use this instance) and that n8n is reachable from here.',
		};
	}
	if (status === 401) {
		return {
			message: 'The API key is not valid',
			description:
				'n8n rejected the API key. Sorry, the key in the Execution Tags API credential is wrong, expired or belongs to another instance. Create a new one in n8n under Settings → n8n API.',
		};
	}
	if (status === 403) {
		return {
			message: 'The API key has no access to this action',
			description:
				'The key is valid but is missing a scope. Required: execution:list, executionTags:list, executionTags:update; for tags by name also tag:list and tag:create. Edit the key in Settings → n8n API.',
		};
	}
	if (/some tags not found/i.test(raw)) {
		return ctx.tagsBy === 'names'
			? {
					message: 'n8n does not accept these tags as execution tags',
					description:
						'Tags created or found through the n8n /tags API are not execution (annotation) tags in your n8n, so they cannot be assigned. Create the tag in the n8n UI (open an execution and add a tag), run "Get Tags" on that execution to read its ID, and use "Tags By: IDs".',
				}
			: {
					message: 'One or more tag IDs do not exist',
					description:
						'Use IDs of execution (annotation) tags, not names. To find an ID, run "Get Tags" on an execution that already has the tag.',
				};
	}
	if (status === 404 || /could not be found|not found/i.test(raw)) {
		return {
			message: `Not found: execution ${ctx.executionId} or the n8n public API at ${ctx.baseUrl}`,
			description:
				'Check the Execution ID and the Base URL (it should end with /api/v1), and that the public API is enabled on your n8n instance.',
		};
	}
	if (status === 415) {
		return {
			message: 'n8n rejected the request format (415)',
			description: 'The request was sent without a supported Content-Type. Please report this as a bug.',
		};
	}
	return undefined;
}

export class ExecutionTags implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Execution Tags',
		name: 'executionTags',
		icon: { light: 'file:executionTags.svg', dark: 'file:executionTags.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Get or change annotation tags of an execution via the n8n public API',
		defaults: { name: 'Execution Tags' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		// Own credential: n8n public API key + Base URL (must end with /api/v1)
		credentials: [{ name: 'executionTagsApi', required: true, testedBy: 'executionTagsApiTest' }],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'add',
				options: [
					{ name: 'Add Tags', value: 'add', action: 'Add tags to execution', description: 'Keep existing tags and add new ones' },
					{ name: 'Get Tags', value: 'get', action: 'Get tags of execution' },
					{ name: 'Remove Tags', value: 'remove', action: 'Remove tags from execution' },
					{ name: 'Set Tags (Replace)', value: 'set', action: 'Replace tags of execution', description: 'Replace the whole tag set' },
				],
			},
			{
				displayName: 'Execution ID',
				name: 'executionId',
				type: 'string',
				default: '={{ $execution.id }}',
				required: true,
				description: 'Defaults to the current execution',
			},
			{
				displayName: 'Tags By',
				name: 'tagsBy',
				type: 'options',
				default: 'ids',
				options: [
					{ name: 'IDs', value: 'ids', description: 'Use execution tag IDs directly (recommended)' },
					{ name: 'Names (Experimental)', value: 'names', description: 'Look tags up by name via the /tags API; works only if your n8n shares these tags with executions' },
				],
				displayOptions: { show: { operation: ['add', 'set', 'remove'] } },
			},
			{
				displayName: 'Tag Names',
				name: 'tagNames',
				type: 'string',
				default: '',
				placeholder: 'API-123, nightly',
				description:
					'Comma-separated tag names. For "Set Tags" an empty value clears all tags.',
				displayOptions: { show: { operation: ['add', 'set', 'remove'], tagsBy: ['names'] } },
			},
			{
				displayName: 'Create Missing Tags',
				name: 'createMissing',
				type: 'boolean',
				default: true,
				description: 'Whether to create tags that do not exist yet (Add Tags and Set Tags only)',
				displayOptions: { show: { operation: ['add', 'set'], tagsBy: ['names'] } },
			},
			{
				displayName: 'Tag IDs',
				name: 'tagIds',
				type: 'string',
				default: '',
				placeholder: 'tagId1, tagId2',
				description: 'Comma-separated tag IDs. For "Set Tags" an empty value clears all tags.',
				displayOptions: { show: { operation: ['add', 'set', 'remove'], tagsBy: ['ids'] } },
			},
		],
		usableAsTool: true,
	};

	methods = {
		credentialTest: {
			async executionTagsApiTest(
				this: ICredentialTestFunctions,
				credential: ICredentialsDecrypted,
			): Promise<INodeCredentialTestResult> {
				const data = credential.data ?? {};
				const rawUrl = String(data.baseUrl ?? '').trim();
				if (!rawUrl) {
					return {
						status: 'OK',
						message:
							'Base URL is empty: the URL of this n8n instance will be used when the node runs (connection not tested)',
					};
				}
				const baseUrl = `${rawUrl.replace(/\/+$/, '').replace(/\/api\/v1$/, '')}/api/v1`;
				try {
					// ICredentialTestFunctions only exposes the legacy `request` helper
					// eslint-disable-next-line @n8n/community-nodes/no-deprecated-workflow-functions
					await this.helpers.request({
						method: 'GET',
						url: `${baseUrl}/executions`,
						qs: { limit: 1 },
						headers: { 'X-N8N-API-KEY': String(data.apiKey ?? '') },
						json: true,
					});
					return { status: 'OK', message: 'Connection tested successfully' };
				} catch (error) {
					return { status: 'Error', message: (error as Error).message };
				}
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const credentials = await this.getCredentials('executionTagsApi');
		// Empty Base URL means "this n8n instance"
		const rawBaseUrl = String(credentials.baseUrl ?? '').trim() || this.getInstanceBaseUrl();
		const baseUrl = `${rawBaseUrl.replace(/\/+$/, '').replace(/\/api\/v1$/, '')}/api/v1`;

		const api = async (
			method: 'GET' | 'PUT' | 'POST',
			path: string,
			body?: IDataObject | IDataObject[],
			qs?: IDataObject,
		) => {
			const options: IHttpRequestOptions = { method, url: `${baseUrl}${path}`, json: true };
			if (body) {
				options.body = body;
				options.headers = { 'Content-Type': 'application/json' };
			}
			if (qs) options.qs = qs;
			return await this.helpers.httpRequestWithAuthentication.call(
				this,
				'executionTagsApi',
				options,
			);
		};

		const request = async (method: 'GET' | 'PUT', executionId: string, body?: TagRef[]) =>
			(await api(
				method,
				`/executions/${encodeURIComponent(executionId)}/tags`,
				body as IDataObject[] | undefined,
			)) as TagRef[];

		// name -> id of all tags, loaded lazily once per run
		let tagIdByName: Map<string, string> | undefined;
		const loadTags = async () => {
			if (tagIdByName) return tagIdByName;
			tagIdByName = new Map();
			let cursor: string | undefined;
			do {
				const page = (await api('GET', '/tags', undefined, {
					limit: 250,
					...(cursor ? { cursor } : {}),
				})) as { data?: TagRef[]; nextCursor?: string | null };
				for (const tag of page.data ?? []) {
					if (tag.name !== undefined) tagIdByName.set(tag.name, tag.id);
				}
				cursor = page.nextCursor ?? undefined;
			} while (cursor);
			return tagIdByName;
		};

		const namesToIds = async (names: string[], createMissing: boolean) => {
			const known = await loadTags();
			const ids: string[] = [];
			for (const name of names) {
				let id = known.get(name);
				if (id === undefined && createMissing) {
					const created = (await api('POST', '/tags', { name })) as TagRef;
					id = created.id;
					known.set(name, id);
				}
				if (id !== undefined) ids.push(id);
			}
			return ids;
		};

		for (let i = 0; i < items.length; i++) {
			const ctx: ErrorContext = { baseUrl, executionId: '', tagsBy: 'names' };
			try {
				const operation = this.getNodeParameter('operation', i) as string;
				const executionId = String(this.getNodeParameter('executionId', i)).trim();
				if (!executionId) {
					throw new NodeOperationError(this.getNode(), 'Execution ID is empty', { itemIndex: i });
				}
				ctx.executionId = executionId;
				ctx.tagsBy = operation === 'get' ? '' : String(this.getNodeParameter('tagsBy', i, 'ids'));

				const splitList = (value: string) =>
					value
						.split(',')
						.map((v) => v.trim())
						.filter(Boolean);

				let requested: string[] = [];
				if (operation !== 'get') {
					if (this.getNodeParameter('tagsBy', i, 'ids') === 'names') {
						const names = splitList(String(this.getNodeParameter('tagNames', i, '')));
						const createMissing =
							operation !== 'remove' && (this.getNodeParameter('createMissing', i, true) as boolean);
						requested = await namesToIds(names, createMissing);
					} else {
						requested = splitList(String(this.getNodeParameter('tagIds', i, '')));
					}
				}

				let tags: TagRef[];

				if (operation === 'get') {
					tags = await request('GET', executionId);
				} else if (operation === 'set') {
					tags = await request('PUT', executionId, requested.map((id) => ({ id })));
				} else {
					// add / remove: read current set first, then write the merged result
					const current = (await request('GET', executionId)) ?? [];
					const currentIds = current.map((t) => t.id);
					const nextIds =
						operation === 'add'
							? Array.from(new Set([...currentIds, ...requested]))
							: currentIds.filter((id) => !requested.includes(id));
					tags = await request('PUT', executionId, nextIds.map((id) => ({ id })));
				}

				returnData.push({
					json: { executionId, operation, tags } as unknown as IDataObject,
					pairedItem: { item: i },
				});
			} catch (error) {
				const friendly = explainError(error, ctx);
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: friendly?.message ?? (error as Error).message, hint: friendly?.description },
						pairedItem: { item: i },
					});
					continue;
				}
				if (error instanceof NodeOperationError) {
					throw new NodeOperationError(this.getNode(), error, { itemIndex: i });
				}
				throw new NodeApiError(this.getNode(), error as JsonObject, {
					itemIndex: i,
					...(friendly ?? {}),
				});
			}
		}

		return [returnData];
	}
}
