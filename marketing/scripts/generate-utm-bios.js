const bios = [
  {
    platform: 'Reddit',
    handle: 'u/textboss_au',
    bio: 'Structured language for client communication. Stop improvising, start controlling. → textboss.com.au',
    url: 'https://textboss.com.au?utm_source=reddit&utm_medium=social&utm_campaign=organic'
  },
  {
    platform: 'LinkedIn (Company Page)',
    handle: 'Text Boss',
    bio: 'Client communication for people who are done improvising. Tier-gated AI + structured language for freelancers, consultants, and service providers.',
    url: 'https://textboss.com.au?utm_source=linkedin&utm_medium=social&utm_campaign=organic'
  },
  {
    platform: 'X / Twitter',
    handle: '@textboss_au',
    bio: 'Say less. Mean more. Leave nothing open. // Client comms + AI scheduling for people who stopped being "nice" about it.',
    url: 'https://textboss.com.au?utm_source=x&utm_medium=social&utm_campaign=organic'
  },
  {
    platform: 'Instagram',
    handle: '@textboss.au',
    bio: 'Controlled client communication.\nScope creep ends here.\nLink →',
    url: 'https://textboss.com.au?utm_source=instagram&utm_medium=social&utm_campaign=organic'
  }
];

bios.forEach(b => {
  console.log(`\n── ${b.platform} (${b.handle}) ──`);
  console.log(`Bio: ${b.bio}`);
  console.log(`URL: ${b.url}`);
});
