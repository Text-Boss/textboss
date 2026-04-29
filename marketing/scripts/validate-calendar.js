const fs = require('fs');
const path = require('path');

const calendarPath = process.argv[2] || path.join(__dirname, '../content-calendar/calendar.json');

const calendar = JSON.parse(fs.readFileSync(calendarPath, 'utf8'));

const REQUIRED_FIELDS = ['id', 'platform', 'pillar', 'audience', 'copy', 'hashtags', 'scheduled_time', 'status'];
const VALID_PLATFORMS = ['reddit', 'linkedin', 'x', 'instagram'];
const VALID_PILLARS = ['soft-reply-tax', 'before-after', 'language-problem', 'no-show-chaos', 'tier-awareness'];
const VALID_AUDIENCES = ['freelancers-contractors', 'tradespeople-service', 'consultants-agency'];
const VALID_STATUSES = ['draft', 'approved', 'posted', 'failed'];

const errors = [];

if (!Array.isArray(calendar)) {
  errors.push('Calendar must be an array');
  report(errors);
  process.exit(1);
}

calendar.forEach((post, i) => {
  const prefix = `Post[${i}] (${post.id || 'no-id'})`;

  REQUIRED_FIELDS.forEach(f => {
    if (post[f] === undefined || post[f] === null || post[f] === '') {
      errors.push(`${prefix}: missing required field "${f}"`);
    }
  });

  if (post.platform && !VALID_PLATFORMS.includes(post.platform)) {
    errors.push(`${prefix}: invalid platform "${post.platform}"`);
  }
  if (post.pillar && !VALID_PILLARS.includes(post.pillar)) {
    errors.push(`${prefix}: invalid pillar "${post.pillar}"`);
  }
  if (post.audience && !VALID_AUDIENCES.includes(post.audience)) {
    errors.push(`${prefix}: invalid audience "${post.audience}"`);
  }
  if (post.status && !VALID_STATUSES.includes(post.status)) {
    errors.push(`${prefix}: invalid status "${post.status}"`);
  }
  if (post.platform === 'reddit' && !post.reddit_type) {
    errors.push(`${prefix}: reddit posts require "reddit_type" field ("comment" or "post")`);
  }
  if (post.platform === 'reddit' && post.reddit_type === 'post' && !post.subreddit) {
    errors.push(`${prefix}: reddit post type requires "subreddit" field`);
  }
  if (post.scheduled_time && isNaN(Date.parse(post.scheduled_time))) {
    errors.push(`${prefix}: "scheduled_time" is not a valid ISO 8601 date`);
  }
});

function report(errs) {
  if (errs.length === 0) {
    console.log(`✓ Calendar valid — ${calendar.length} posts`);
  } else {
    console.error(`✗ Calendar has ${errs.length} error(s):`);
    errs.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }
}

report(errors);
