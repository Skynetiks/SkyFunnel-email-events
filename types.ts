export type Mail = {
  timestamp: string;
  source: string;
  sourceArn: string;
  sendingAccountId: string;
  messageId: string;
  destination: string[];
  headersTruncated: boolean;
  headers: Array<{
    name: string;
    value: string;
  }>;
  commonHeaders: {
    from: string[];
    replyTo: string[];
    to: string[];
    messageId: string;
    subject: string;
  };
  tags: {
    'ses:source-tls-version': string[];
    'ses:operation': string[];
    'ses:configuration-set': string[];
    'ses:recipient-isp': string[];
    'ses:source-ip': string[];
    'ses:from-domain': string[];
    'ses:sender-identity': string[];
    'ses:caller-identity': string[];
  };
};
