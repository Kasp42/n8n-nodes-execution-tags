import {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	JsonObject,
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
		credentials: [{ name: 'executionTagsApi', required: true }],
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
				description:
					'Comma-separated IDs of execution annotation tags. For "Set Tags" an empty value clears all tags.',
				displayOptions: { show: { operation: ['add', 'set', 'remove'] } },
			},
		],
		usableAsTool: true,
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const credentials = await this.getCredentials('executionTagsApi');
		const baseUrl = `${String(credentials.baseUrl)
			.replace(/\/+$/, '')
			.replace(/\/api\/v1$/, '')}/api/v1`;

		const request = async (method: 'GET' | 'PUT', executionId: string, body?: TagRef[]) => {
			const options: IHttpRequestOptions = {
				method,
				url: `${baseUrl}/executions/${encodeURIComponent(executionId)}/tags`,
				json: true,
			};
			if (body) options.body = body;
			return (await this.helpers.httpRequestWithAuthentication.call(
				this,
				'executionTagsApi',
				options,
			)) as TagRef[];
		};

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;
				const executionId = String(this.getNodeParameter('executionId', i)).trim();
				if (!executionId) {
					throw new NodeOperationError(this.getNode(), 'Execution ID is empty', { itemIndex: i });
				}

				const requested =
					operation === 'get'
						? []
						: String(this.getNodeParameter('tagIds', i, ''))
								.split(',')
								.map((s) => s.trim())
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
