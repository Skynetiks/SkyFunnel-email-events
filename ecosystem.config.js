module.exports = {
	apps: [
		{
			name: "theprospect-sqs-poll",
			script: "./node_modules/.bin/ts-node",
			args: "index.ts",
			watch: true,
			env_production: {
				NODE_ENV: "production",
				PORT: 8000,
				SQS_QUEUE_URL: "https://sqs.us-east-1.amazonaws.com/211125710904/SkyFunnel-Email-Queue",
				S3_REGION: "us-east-1",
				AWS_ACCESS_KEY_ID: "AKIATCKASWA4B2Y7DLSF",
				AWS_SECRET_ACCESS_KEY: "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",
				// Add other environment variables here
			}
		}
	]
};
