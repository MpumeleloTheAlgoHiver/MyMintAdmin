const fs = require('fs');
const file = '/Users/mufaroncube/Documents/MyMintAdmin1/public/dividends.html';
let content = fs.readFileSync(file, 'utf8');

// Replace tab-email HTML
const oldHtml = `<div id="tab-email" class="tab-content">
            <div class="email-controls">
              <div class="field" style="margin-bottom:0; flex: 1;">
                <label class="field-label" for="testEmail">Test Email Address</label>
                <input type="email" id="testEmail" class="field-input" placeholder="Enter test email">
              </div>
              <button class="extract-btn" id="sendTestBtn" type="button" style="width:auto; padding:9px 16px;">Send Test</button>
              <button class="extract-btn" id="sendAllBtn" type="button" style="width:auto; padding:9px 16px; background:#059669;">Send All Emails</button>
            </div>
            <div id="emailPreviewContent">
              <div class="skel" style="height:400px;border-radius:10px;"></div>
            </div>
          </div>`;

const newHtml = `<div id="tab-email" class="tab-content">
            <div class="email-controls">
              <div class="field" style="margin-bottom:0; flex: 1;">
                <label class="field-label" for="testEmail">Test Email Address</label>
                <input type="email" id="testEmail" class="field-input" placeholder="Enter test email">
              </div>
              <button class="extract-btn" id="sendTestBtn" type="button" style="width:auto; padding:9px 16px;">Send Test</button>
              <button class="extract-btn" id="sendAllBtn" type="button" style="width:auto; padding:9px 16px; background:#059669;">Send All Emails</button>
            </div>
            <div style="display:flex; gap: 16px; height: 600px;">
               <div id="emailUsersList" style="width: 250px; overflow-y: auto; border: 1px solid var(--border); border-radius: 12px; background: #fff;">
                  <div class="skel" style="height:100%;border-radius:12px;"></div>
               </div>
               <div id="emailPreviewContent" style="flex:1;">
                  <div class="skel" style="height:100%;border-radius:12px;"></div>
               </div>
            </div>
          </div>`;

content = content.replace(oldHtml, newHtml);


// Replace the email preview logic
const oldLogic = `        if (!previewData.ok) {
          document.getElementById('emailPreviewContent').innerHTML = 
            \`<div style="text-align:center;padding:24px;color:#dc2626;font-size:12px;">Failed to load email preview: \${previewData.error}</div>\`;
        } else {
          const iframe = document.createElement('iframe');
          iframe.className = 'email-preview-frame';
          document.getElementById('emailPreviewContent').innerHTML = '';
          document.getElementById('emailPreviewContent').appendChild(iframe);
          
          iframe.contentWindow.document.open();
          iframe.contentWindow.document.write(previewData.html);
          iframe.contentWindow.document.close();

          // Bind buttons
          const testEmailInput = document.getElementById('testEmail');
          const sendTestBtn = document.getElementById('sendTestBtn');
          const sendAllBtn = document.getElementById('sendAllBtn');

          sendTestBtn.onclick = async () => {
            const email = testEmailInput.value;
            if (!email) return showToast('warning', 'Please enter a test email');
            sendTestBtn.disabled = true;
            sendTestBtn.textContent = 'Sending...';
            try {
              const res = await fetch('/api/dividends/email', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ run_id: runId, testEmail: email })
              });
              const data = await res.json();
              if (data.ok) showToast('success', 'Test email sent successfully');
              else showToast('error', data.error || 'Failed to send test email');
            } catch (e) {
              showToast('error', 'Network error');
            }
            sendTestBtn.disabled = false;
            sendTestBtn.textContent = 'Send Test';
          };

          sendAllBtn.onclick = async () => {
            if (!confirm(\`Are you sure you want to send emails to all matched clients for run \${fileName}?\`)) return;
            sendAllBtn.disabled = true;
            sendAllBtn.textContent = 'Sending...';
            try {
              const res = await fetch('/api/dividends/email', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ run_id: runId, sendAll: true })
              });
              const data = await res.json();
              if (data.ok) showToast('success', \`Sent \${data.sent} emails. Failed: \${data.failed}\`);
              else showToast('error', data.error || 'Failed to send bulk emails');
            } catch (e) {
              showToast('error', 'Network error');
            }
            sendAllBtn.disabled = false;
            sendAllBtn.textContent = 'Send All Emails';
          };
        }`;

const newLogic = `        if (!previewData.ok) {
          document.getElementById('emailPreviewContent').innerHTML = 
            \`<div style="text-align:center;padding:24px;color:#dc2626;font-size:12px;">Failed to load email preview: \${previewData.error}</div>\`;
          document.getElementById('emailUsersList').innerHTML = '';
        } else {
           const allClients = previewData.allClients || [];
           
           const renderList = () => {
              const listHtml = allClients.map(c => \`
                <div class="user-item" data-code="\${c.client_code}" style="padding: 12px; border-bottom: 1px solid #e8e4f3; cursor: pointer; display: flex; align-items: center; justify-content: space-between;">
                   <div>
                      <div style="font-size: 13px; font-weight: 600; color: #1e293b;">\${c.first_name}</div>
                      <div style="font-size: 11px; color: #64748b;">\${c.client_code}</div>
                   </div>
                   \${c.has_sent ? '<span style="font-size: 10px; background: #dcfce7; color: #166534; padding: 2px 6px; border-radius: 10px; font-weight: 600;">Sent</span>' : ''}
                </div>
              \`).join('');
              document.getElementById('emailUsersList').innerHTML = listHtml;

              document.querySelectorAll('.user-item').forEach(el => {
                 el.onclick = () => selectUser(el.dataset.code);
              });
           };

           let activeCode = previewData.previewCode;

           const renderPreviewFrame = (htmlContent, clientCode, hasSent) => {
              const iframe = document.createElement('iframe');
              iframe.className = 'email-preview-frame';
              iframe.style.height = 'calc(100% - 60px)';
              iframe.style.borderRadius = '0 0 12px 12px';
              iframe.style.borderTop = 'none';
              
              const header = document.createElement('div');
              header.style.padding = '12px 16px';
              header.style.border = '1px solid var(--border)';
              header.style.borderBottom = '1px solid #e2e8f0';
              header.style.borderRadius = '12px 12px 0 0';
              header.style.background = '#f8f7ff';
              header.style.display = 'flex';
              header.style.justifyContent = 'space-between';
              header.style.alignItems = 'center';

              const sendBtn = document.createElement('button');
              sendBtn.className = 'extract-btn';
              sendBtn.style.width = 'auto';
              sendBtn.style.padding = '6px 12px';
              sendBtn.style.fontSize = '12px';
              if (hasSent) {
                 sendBtn.textContent = 'Already Sent';
                 sendBtn.disabled = true;
                 sendBtn.style.background = '#94a3b8';
              } else {
                 sendBtn.textContent = 'Send Email to ' + clientCode;
                 sendBtn.onclick = () => sendToUser(clientCode);
              }

              header.innerHTML = \`<span style="font-size: 13px; font-weight: 600; color: #475569;">Preview: \${clientCode}</span>\`;
              header.appendChild(sendBtn);

              const content = document.getElementById('emailPreviewContent');
              content.innerHTML = '';
              content.appendChild(header);
              content.appendChild(iframe);

              iframe.contentWindow.document.open();
              iframe.contentWindow.document.write(htmlContent);
              iframe.contentWindow.document.close();
           };

           const selectUser = async (code) => {
              activeCode = code;
              document.querySelectorAll('.user-item').forEach(el => {
                 if (el.dataset.code === code) el.style.background = '#f3efff';
                 else el.style.background = 'transparent';
              });
              
              document.getElementById('emailPreviewContent').innerHTML = '<div style="padding: 24px; text-align: center; color: #64748b;">Loading preview...</div>';
              
              try {
                const res = await fetch(\`/api/dividends/email?run_id=\${runId}&client_code=\${code}\`, { headers: authHeaders });
                const data = await res.json();
                if (data.ok) {
                   const cInfo = allClients.find(c => c.client_code === code);
                   renderPreviewFrame(data.html, code, cInfo?.has_sent);
                } else {
                   document.getElementById('emailPreviewContent').innerHTML = \`<div style="text-align:center;padding:24px;color:#dc2626;font-size:12px;">\${data.error}</div>\`;
                }
              } catch (e) { }
           };

           const sendToUser = async (code) => {
              if (!confirm('Send email to ' + code + '?')) return;
              try {
                 const res = await fetch('/api/dividends/email', {
                    method: 'POST',
                    headers: authHeaders,
                    body: JSON.stringify({ run_id: runId, client_code: code })
                 });
                 const data = await res.json();
                 if (data.ok) {
                    showToast('success', 'Email sent to ' + code);
                    const cInfo = allClients.find(c => c.client_code === code);
                    if (cInfo) cInfo.has_sent = true;
                    renderList();
                    selectUser(code);
                 } else {
                    showToast('error', data.error || 'Failed to send');
                 }
              } catch (e) {
                 showToast('error', 'Network error');
              }
           };

           const testEmailInput = document.getElementById('testEmail');
           const sendTestBtn = document.getElementById('sendTestBtn');
           const sendAllBtn = document.getElementById('sendAllBtn');

           sendTestBtn.onclick = async () => {
              const email = testEmailInput.value;
              if (!email) return showToast('warning', 'Please enter a test email');
              sendTestBtn.disabled = true;
              sendTestBtn.textContent = 'Sending...';
              try {
                 const res = await fetch('/api/dividends/email', {
                    method: 'POST',
                    headers: authHeaders,
                    body: JSON.stringify({ run_id: runId, testEmail: email, client_code: activeCode })
                 });
                 const data = await res.json();
                 if (data.ok) showToast('success', 'Test email sent successfully');
                 else showToast('error', data.error || 'Failed to send test email');
              } catch (e) {
                 showToast('error', 'Network error');
              }
              sendTestBtn.disabled = false;
              sendTestBtn.textContent = 'Send Test';
           };

           sendAllBtn.onclick = async () => {
              const unsent = allClients.filter(c => !c.has_sent).length;
              if (unsent === 0) return showToast('warning', 'All users have already received this email');
              if (!confirm(\`Are you sure you want to send emails to \${unsent} clients who haven't received it yet for run \${fileName}?\`)) return;
              
              sendAllBtn.disabled = true;
              sendAllBtn.textContent = 'Sending...';
              try {
                 const res = await fetch('/api/dividends/email', {
                    method: 'POST',
                    headers: authHeaders,
                    body: JSON.stringify({ run_id: runId, sendAll: true })
                 });
                 const data = await res.json();
                 if (data.ok) {
                    showToast('success', \`Sent \${data.sent} emails. Failed: \${data.failed}\`);
                    // mark newly sent
                    (data.newlySentCodes || []).forEach(code => {
                       const cInfo = allClients.find(c => c.client_code === code);
                       if (cInfo) cInfo.has_sent = true;
                    });
                    renderList();
                    if (activeCode) selectUser(activeCode);
                 } else {
                    showToast('error', data.error || 'Failed to send bulk emails');
                 }
              } catch (e) {
                 showToast('error', 'Network error');
              }
              sendAllBtn.disabled = false;
              sendAllBtn.textContent = 'Send All Emails';
           };

           renderList();
           if (activeCode) {
              selectUser(activeCode);
           }
        }`;

content = content.replace(oldLogic, newLogic);
fs.writeFileSync(file, content);
console.log('Patched html successfully');
