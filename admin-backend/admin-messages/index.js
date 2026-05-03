const jwt = require('jsonwebtoken');
const {
  DynamoDBClient,
  ScanCommand,
  DeleteItemCommand,
} = require('@aws-sdk/client-dynamodb');

const JWT_SECRET = process.env.JWT_SECRET;
const TABLE_NAME = process.env.MESSAGES_TABLE;

const ALLOWED_ORIGINS = new Set([
  'https://joshuasuzuki.com',
  'https://www.joshuasuzuki.com',
]);
const DEFAULT_ORIGIN = 'https://www.joshuasuzuki.com';

const MAX_ID_LENGTH = 256;

const db = new DynamoDBClient({ region: 'us-east-1' });

exports.handler = async (event) => {
  console.log('admin-messages event:', JSON.stringify(redactEvent(event)));

  try {
    if (!JWT_SECRET) {
      console.error('JWT_SECRET not set');
      return errorResponse(event, 500, 'Server misconfigured');
    }
    if (!TABLE_NAME) {
      console.error('MESSAGES_TABLE not set');
      return errorResponse(event, 500, 'Server misconfigured');
    }

    const method =
      event.requestContext?.http?.method || event.httpMethod || 'GET';

    const authHeader =
      event.headers?.Authorization || event.headers?.authorization || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return errorResponse(event, 401, 'Unauthorized');
    }

    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (payload.role !== 'admin') {
        return errorResponse(event, 401, 'Unauthorized');
      }
    } catch (err) {
      console.error('JWT verify error', err.name);
      return errorResponse(event, 401, 'Unauthorized');
    }

    if (method === 'GET') {
      return await handleList(event);
    } else if (method === 'DELETE') {
      return await handleDelete(event);
    }

    return errorResponse(event, 405, `Method ${method} not allowed`);
  } catch (err) {
    console.error('Unexpected error in admin-messages:', err);
    return errorResponse(event, 500, 'Unexpected error');
  }
};

async function handleList(event) {
  try {
    const result = await db.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        Limit: 100,
      })
    );

    const items = (result.Items || []).map((item) => ({
      id: item.id?.S,
      name: item.name?.S,
      email: item.email?.S,
      message: item.message?.S,
      createdAt: item.createdAt?.S,
    }));

    return {
      statusCode: 200,
      headers: corsHeaders(event),
      body: JSON.stringify({ items }),
    };
  } catch (dbErr) {
    console.error('DynamoDB list error:', dbErr.name);
    return errorResponse(event, 500, 'DynamoDB error');
  }
}

async function handleDelete(event) {
  const id =
    event.pathParameters?.id ||
    event.pathParameters?.messageId ||
    null;

  if (!id) {
    return errorResponse(event, 400, 'Missing id path parameter');
  }
  if (typeof id !== 'string' || id.length > MAX_ID_LENGTH) {
    return errorResponse(event, 400, 'Invalid id');
  }

  try {
    await db.send(
      new DeleteItemCommand({
        TableName: TABLE_NAME,
        Key: {
          id: { S: id },
        },
      })
    );

    return {
      statusCode: 204,
      headers: corsHeaders(event),
      body: '',
    };
  } catch (dbErr) {
    console.error('DynamoDB delete error:', dbErr.name);
    return errorResponse(event, 500, 'DynamoDB error');
  }
}

function errorResponse(event, statusCode, message) {
  return {
    statusCode,
    headers: corsHeaders(event),
    body: JSON.stringify({ message }),
  };
}

function corsHeaders(event) {
  const requestOrigin =
    event?.headers?.origin || event?.headers?.Origin || '';
  const allow = ALLOWED_ORIGINS.has(requestOrigin)
    ? requestOrigin
    : DEFAULT_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'OPTIONS,GET,DELETE',
    Vary: 'Origin',
  };
}

function redactEvent(event) {
  if (!event || typeof event !== 'object') return event;
  const headers = event.headers || {};
  const safeHeaders = { ...headers };
  if (safeHeaders.Authorization) safeHeaders.Authorization = '[redacted]';
  if (safeHeaders.authorization) safeHeaders.authorization = '[redacted]';
  if (safeHeaders.cookie) safeHeaders.cookie = '[redacted]';
  if (safeHeaders.Cookie) safeHeaders.Cookie = '[redacted]';
  return { ...event, headers: safeHeaders };
}
