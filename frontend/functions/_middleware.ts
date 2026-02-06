// Basic Auth for entire site
const CREDENTIALS = {
  username: 'admin',
  password: 'kaiwa2024',
};

export const onRequest: PagesFunction = async (context) => {
  const authorization = context.request.headers.get('Authorization');

  if (!authorization) {
    return new Response('Unauthorized', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Kaiwa LLM Mock"' },
    });
  }

  const [scheme, encoded] = authorization.split(' ');
  if (scheme !== 'Basic' || !encoded) {
    return new Response('Unauthorized', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Kaiwa LLM Mock"' },
    });
  }

  const decoded = atob(encoded);
  const [username, password] = decoded.split(':');

  if (username !== CREDENTIALS.username || password !== CREDENTIALS.password) {
    return new Response('Unauthorized', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Kaiwa LLM Mock"' },
    });
  }

  return context.next();
};
