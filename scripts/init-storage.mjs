import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  GetBucketPolicyCommand,
} from '@aws-sdk/client-s3';
import { SignatureV4 } from '@smithy/signature-v4';
import { HttpRequest } from '@smithy/protocol-http';
import { Hash } from '@smithy/hash-node';
import { isDeepStrictEqual } from 'node:util';

// This provider-specific bootstrap is never imported by application storage code.
const {
  S3_ENDPOINT,
  S3_BUCKET,
  RUSTFS_ACCESS_KEY,
  RUSTFS_SECRET_KEY,
  S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY,
} = process.env;
if (
  ![
    S3_ENDPOINT,
    S3_BUCKET,
    RUSTFS_ACCESS_KEY,
    RUSTFS_SECRET_KEY,
    S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY,
  ].every(Boolean)
)
  throw new Error('Configure separate root and application storage credentials.');
if (RUSTFS_ACCESS_KEY === S3_ACCESS_KEY_ID)
  throw new Error('The web application must not use root credentials.');
const region = process.env.S3_REGION || 'us-east-1';
const credentials = { accessKeyId: RUSTFS_ACCESS_KEY, secretAccessKey: RUSTFS_SECRET_KEY };
const s3 = new S3Client({
  endpoint: S3_ENDPOINT,
  region,
  forcePathStyle: true,
  credentials,
  maxAttempts: 2,
});
try {
  await s3.send(new HeadBucketCommand({ Bucket: S3_BUCKET }));
} catch (error) {
  if (error.$metadata?.httpStatusCode !== 404)
    throw new Error('Cannot inspect storage bucket. Check readiness and credentials.');
  await s3.send(new CreateBucketCommand({ Bucket: S3_BUCKET }));
}
// Existing policies are never overwritten. An administrator must review them.
try {
  await s3.send(new GetBucketPolicyCommand({ Bucket: S3_BUCKET }));
  throw new Error(
    'Existing bucket policy requires manual review; bootstrap only accepts private buckets without a policy.',
  );
} catch (error) {
  if (
    !['NoSuchBucketPolicy', 'NoSuchPolicy'].includes(error.name) &&
    error.$metadata?.httpStatusCode !== 404
  )
    throw error;
}
const signer = new SignatureV4({
  credentials,
  region,
  service: 's3',
  sha256: Hash.bind(null, 'sha256'),
});
export async function admin(method, operation, query = {}, value) {
  const endpoint = new URL(S3_ENDPOINT);
  const body = value ? JSON.stringify(value) : undefined;
  const request = await signer.sign(
    new HttpRequest({
      protocol: endpoint.protocol,
      hostname: endpoint.hostname,
      port: Number(endpoint.port) || undefined,
      method,
      path: `/rustfs/admin/v3/${operation}`,
      query,
      headers: { host: endpoint.host, ...(body ? { 'content-type': 'application/json' } : {}) },
      body,
    }),
  );
  const url = new URL(request.path, endpoint);
  for (const [key, val] of Object.entries(query)) url.searchParams.set(key, val);
  const response = await fetch(url, {
    method,
    headers: request.headers,
    body,
    signal: AbortSignal.timeout(15000),
  });
  return response;
}
const user = await admin('GET', 'user-info', { accessKey: S3_ACCESS_KEY_ID });
const policyName = `tournament-${S3_BUCKET}`;
const policy = {
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Allow',
      Action: ['s3:ListBucket', 's3:GetBucketLocation'],
      Resource: [`arn:aws:s3:::${S3_BUCKET}`],
    },
    {
      Effect: 'Allow',
      Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
      Resource: [`arn:aws:s3:::${S3_BUCKET}/*`],
    },
  ],
};
async function success(response) {
  if (!response.ok)
    throw new Error(
      `Storage identity initialization failed (${response.status}); credentials are not logged.`,
    );
}
const existingPolicy = await admin('GET', 'info-canned-policy', { name: policyName });
if (existingPolicy.status === 404)
  await success(await admin('PUT', 'add-canned-policy', { name: policyName }, policy));
else {
  await success(existingPolicy);
  if (!isDeepStrictEqual((await existingPolicy.json()).policy, policy))
    throw new Error(
      'Existing storage policy differs. Review it manually; no policy was overwritten.',
    );
}
let binding = '';
if (user.status === 404) {
  await success(
    await admin(
      'PUT',
      'add-user',
      { accessKey: S3_ACCESS_KEY_ID },
      { secretKey: S3_SECRET_ACCESS_KEY, status: 'enabled' },
    ),
  );
} else {
  await success(user);
  binding = (await user.json()).policyName || '';
  if (binding && binding !== policyName)
    throw new Error(
      'Existing storage user has different policies. Review them manually; no binding was replaced.',
    );
}
if (!binding)
  await success(
    await admin(
      'POST',
      'idp/builtin/policy/attach',
      {},
      { policies: [policyName], user: S3_ACCESS_KEY_ID },
    ),
  );
const app = new S3Client({
  endpoint: S3_ENDPOINT,
  region,
  forcePathStyle: true,
  credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
});
await app.send(new HeadBucketCommand({ Bucket: S3_BUCKET }));
console.log(
  'Private bucket and application credentials ready; existing credentials were not replaced.',
);
app.destroy();
s3.destroy();
