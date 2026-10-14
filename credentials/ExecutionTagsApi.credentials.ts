import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class ExecutionTagsApi implements ICredentialType {
	name = 'executionTagsApi';

	displayName = 'Execution Tags API';

	icon = 'file:executionTags.svg' as const;

	documentationUrl = 'https://docs.n8n.io/api/authentication/';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://<your-n8n-host>/api/v1',
			description: 'Base URL of the n8n public API (must end with /api/v1)',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: { 'X-N8N-API-KEY': '={{$credentials.apiKey}}' },
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/executions',
			qs: { limit: 1 },
		},
	};
}
