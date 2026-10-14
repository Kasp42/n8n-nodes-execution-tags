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
			displayName:
				'Create the key in your n8n instance: <b>Settings → n8n API</b>. The key needs the scopes <code>execution:list</code>, <code>executionTags:list</code> and <code>executionTags:update</code>. <a href="https://docs.n8n.io/api/authentication/" target="_blank">Docs</a>',
			name: 'notice',
			type: 'notice',
			default: '',
		},
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
			default: 'http://localhost:5678/api/v1',
			placeholder: 'https://your-n8n-host/api/v1',
			description:
				'URL of your n8n instance. "/api/v1" is appended automatically if it is missing.',
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
			baseURL:
				"={{$credentials.baseUrl.replace(/\\/+$/, '').replace(/\\/api\\/v1$/, '') + '/api/v1'}}",
			url: '/executions',
			qs: { limit: 1 },
		},
	};
}
