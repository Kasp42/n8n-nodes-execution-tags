import type {
	IAuthenticateGeneric,
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
				'Create the key in your n8n instance: <b>Settings → n8n API</b>. The key needs the scopes <code>execution:list</code> (credential test), <code>executionTags:list</code> and <code>executionTags:update</code> (execution tags). <a href="https://docs.n8n.io/api/authentication/" target="_blank">Docs</a>',
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
			default: '',
			placeholder: 'https://your-n8n-host/api/v1',
			description:
				'Leave empty to use this n8n instance. To use another instance, enter its URL; "/api/v1" is appended automatically if it is missing.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: { 'X-N8N-API-KEY': '={{$credentials.apiKey}}' },
		},
	};
}
