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

type ErrorContext = { baseUrl: string; executionId: string };

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
				'The key is valid but is missing a scope. Required: execution:list, executionTags:list, executionTags:update. Edit the key in Settings → n8n API.',
		};
	}
	if (/some tags not found/i.test(raw)) {
		return {
			message: 'One or more tag IDs do not exist',
			description:
				'Use IDs of execution (annotation) tags, not names. The public API cannot create such tags: create the tag in the n8n UI (open an execution and add a tag), then run "Get Tags" on that execution to read its ID.',
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
				displayName: 'Tag IDs',
				name: 'tagIds',
				type: 'string',
				default: '',
				placeholder: 'tagId1, tagId2',
				description: 'Comma-separated tag IDs. For "Set Tags" an empty value clears all tags.',
				displayOptions: { show: { operation: ['add', 'set', 'remove'] } },
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
			method: 'GET' | 'PUT',
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

		for (let i = 0; i < items.length; i++) {
			const ctx: ErrorContext = { baseUrl, executionId: '' };
			try {
				const operation = this.getNodeParameter('operation', i) as string;
				const executionId = String(this.getNodeParameter('executionId', i)).trim();
				if (!executionId) {
					throw new NodeOperationError(this.getNode(), 'Execution ID is empty', { itemIndex: i });
				}
				ctx.executionId = executionId;

				const requested =
					operation === 'get'
						? []
						: String(this.getNodeParameter('tagIds', i, ''))
								.split(',')
								.map((v) => v.trim())
								.filter(Boolean);

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
