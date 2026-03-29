-- Insert a test user for RADIUS testing
INSERT INTO radcheck (username, attribute, op, value)
VALUES ('testuser', 'Cleartext-Password', ':=', 'testpass')
ON CONFLICT DO NOTHING;

-- Insert test user into a group
INSERT INTO radusergroup (username, groupname, priority)
VALUES ('testuser', 'test-profile', 1)
ON CONFLICT DO NOTHING;

-- Insert test group with rate limit
INSERT INTO radgroupreply (groupname, attribute, op, value)
VALUES ('test-profile', 'Mikrotik-Rate-Limit', ':=', '2M/2M')
ON CONFLICT DO NOTHING;
