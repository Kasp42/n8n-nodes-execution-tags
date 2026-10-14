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
				default: 'names',
				options: [
					{ name: 'Names', value: 'names', description: 'Look tags up by name (missing ones can be created)' },
					{ name: 'IDs', value: 'ids', description: 'Use tag IDs directly' },
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
			try {
				const operation = this.getNodeParameter('operation', i) as string;
				const executionId = String(this.getNodeParameter('executionId', i)).trim();
				if (!executionId) {
					throw new NodeOperationError(this.getNode(), 'Execution ID is empty', { itemIndex: i });
				}

				const splitList = (value: string) =>
					value
						.split(',')
						.map((v) => v.trim())
						.filter(Boolean);

				let requested: string[] = [];
				if (operation !== 'get') {
					if (this.getNodeParameter('tagsBy', i, 'names') === 'names') {
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
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
