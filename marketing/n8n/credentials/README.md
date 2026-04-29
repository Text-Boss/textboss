# n8n Platform Credentials Setup

Store all credentials in n8n's built-in credential store — never commit secrets to git.

## Reddit
- Credential type: `Reddit OAuth2 API`
- Client ID: (from reddit.com/prefs/apps)
- Client Secret: (from reddit.com/prefs/apps)
- Username: your Reddit username
- Password: your Reddit password

## LinkedIn
- Credential type: `LinkedIn OAuth2 API`
- Client ID: (from developers.linkedin.com)
- Client Secret: (from developers.linkedin.com)
- Scopes: `w_member_social`, `w_organization_social`

## X / Twitter
- Credential type: `Twitter OAuth1 API`
- API Key: (from developer.twitter.com)
- API Secret: (from developer.twitter.com)
- Access Token: (from developer.twitter.com)
- Access Token Secret: (from developer.twitter.com)

## Instagram (Meta Graph API)
- Credential type: `HTTP Header Auth`
- Name: `Authorization`
- Value: `Bearer <long-lived-page-access-token>`
- Instagram Business Account ID: stored as n8n variable `INSTAGRAM_ACCOUNT_ID`
