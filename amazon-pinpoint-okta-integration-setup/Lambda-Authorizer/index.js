const OktaJwtVerifier = require("@okta/jwt-verifier");

const issuerUrl = process.env.OKTA_ISSUER_URL;

const oktaJwtVerifier = new OktaJwtVerifier({
  issuer: issuerUrl
});

exports.handler = async (event, context, callback) => {
  const token = event.authorizationToken;
  if (!token) {
    callback("Unauthorized");
    return;
  }

  const match = token.match(/Bearer (.+)/);
  if (!match) {
    callback("Unauthorized");
    return;
  }

  try {
    const accessToken = match[1];
    console.log(accessToken);
    if (!accessToken) {
      console.log("No access token");
      callback("Unauthorized");
      return;
    }

    const jwt = await oktaJwtVerifier.verifyAccessToken(accessToken, 'api://default');
    console.log('Token is valid');

    const principalId = jwt.claims.sub;
    const policyDocument = generatePolicy(principalId, 'Allow', event.methodArn);

    callback(null, policyDocument);
  } catch (err) {
    console.warn('Token failed validation:', err.message);
    callback("Unauthorized");
  }
};

const generatePolicy = (principalId, effect, resource) => {
  const authResponse = {};
  authResponse.principalId = principalId;
  if (effect && resource) {
    const policyDocument = {};
    policyDocument.Version = '2012-10-17';
    policyDocument.Statement = [];
    const statementOne = {};
    statementOne.Action = 'execute-api:Invoke';
    statementOne.Effect = effect;
    statementOne.Resource = resource;
    policyDocument.Statement[0] = statementOne;
    authResponse.policyDocument = policyDocument;
  }
  console.log('Generated policy:', JSON.stringify(authResponse, null, 2));
  return authResponse;
};