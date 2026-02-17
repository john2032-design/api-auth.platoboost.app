// api/admin.js
const utils = require('./lib/utils');

const serveAdminPage = (res) => {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Dashboard</title>
  <style>
    body { background-color: #121212; color: #ffffff; font-family: Arial, sans-serif; margin: 0; padding: 20px; }
    .container { max-width: 800px; margin: 0 auto; }
    h1, h2 { text-align: center; }
    form { display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px; }
    input, select, button { padding: 10px; background-color: #333; color: #fff; border: 1px solid #555; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px; border: 1px solid #555; text-align: left; }
    button { cursor: pointer; }
    button:hover { background-color: #555; }
    @media (max-width: 600px) { .container { padding: 10px; } table { font-size: 14px; } }
  </style>
</head>
<body>
  <div class="container">
    <h1>Admin Dashboard</h1>
    <h2>Create API Key</h2>
    <form id="createForm">
      <select id="type">
        <option value="request">Request-based</option>
        <option value="monthly">Monthly</option>
      </select>
      <input type="number" id="value" placeholder="Requests or Months (max 12 for monthly)" min="1" required>
      <button type="submit">Create Key</button>
    </form>
    <h2>Key Usage</h2>
    <table id="keysTable">
      <thead><tr><th>Key</th><th>Type</th><th>Remaining/Expiration</th><th>Usage</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody></tbody>
    </table>
  </div>
  <script>
    const loadKeys = async () => {
      const res = await fetch('/api/keys');
      const data = await res.json();
      const tbody = document.querySelector('#keysTable tbody');
      tbody.innerHTML = '';
      data.keys.forEach(k => {
        const tr = document.createElement('tr');
        tr.innerHTML = \`
          <td>\${k.key}</td>
          <td>\${k.type}</td>
          <td>\${k.type === 'request' ? k.remaining : new Date(k.expiration).toLocaleDateString()}</td>
          <td>\${k.usage}</td>
          <td>\${k.status}</td>
          <td>
            <button onclick="deleteKey('\${k.key}')">Delete</button>
            <button onclick="expireKey('\${k.key}')">Expire</button>
          </td>
        \`;
        tbody.appendChild(tr);
      });
    };
    const createKey = async (e) => {
      e.preventDefault();
      const type = document.getElementById('type').value;
      const value = document.getElementById('value').value;
      const res = await fetch('/api/create-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, value })
      });
      const data = await res.json();
      if (data.status === 'success') {
        alert('Key created: ' + data.apiKey);
        loadKeys();
      } else {
        alert('Error: ' + data.result);
      }
    };
    const deleteKey = async (apiKey) => {
      if (confirm('Delete key?')) {
        await fetch('/api/delete-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey })
        });
        loadKeys();
      }
    };
    const expireKey = async (apiKey) => {
      if (confirm('Expire key?')) {
        await fetch('/api/expire-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey })
        });
        loadKeys();
      }
    };
    document.getElementById('createForm').addEventListener('submit', createKey);
    loadKeys();
  </script>
</body>
</html>
  `;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
};

module.exports = async (req, res) => {
  const handlerStart = utils.getCurrentTime();
  utils.setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!utils.isAdmin(req)) return utils.sendError(res, 403, 'Forbidden', handlerStart);

  serveAdminPage(res);
};