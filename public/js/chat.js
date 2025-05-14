// chat.js: 基于静态页面元素初始化 AI 对话功能
document.addEventListener('DOMContentLoaded', () => {
  const chatBtn = document.getElementById('openChatBtn');
  if (!chatBtn) {
    console.log('chat.js: 非聊天页面，跳过初始化');
    return;
  }
  const chatModal = document.getElementById('chatModal');
  const closeBtn = document.getElementById('closeChatBtn');
  const msgContainer = document.getElementById('chatMessages');
  const inputEl = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendChatBtn');

  console.log('chat.js: 聊天界面已准备');

  // 调试：检查 sendBtn 和 inputEl 引用是否正确
  console.log('chat.js: sendBtn =', sendBtn, 'inputEl =', inputEl);

  closeBtn.addEventListener('click', () => {
    console.log('chat.js: 点击关闭按钮');
    chatModal.style.display = 'none';
  });

  // 绑定 footer 关闭按钮
  const closeFooterBtn = document.getElementById('closeChatFooterBtn');
  if (closeFooterBtn) {
    closeFooterBtn.addEventListener('click', () => {
      console.log('chat.js: 点击底部关闭按钮');
      chatModal.style.display = 'none';
    });
  }

  chatBtn.addEventListener('click', async () => {
    console.log('chat.js: 点击 AI 对话 按钮');
    if (chatModal.style.display === 'flex') {
      chatModal.style.display = 'none';
      return;
    }
    let history = [];
    try {
      const res = await fetch('/chat/history');
      if (res.ok) {
        history = await res.json();
      } else {
        console.error('chat.js: /chat/history 响应错误', res.status);
      }
    } catch (err) {
      console.error('chat.js: 加载历史失败', err);
    }
    // 渲染历史消息
    msgContainer.innerHTML = '';
    history.forEach(item => {
      const role = item.role === 'assistant' ? 'assistant' : 'user';
      addMessage(role, item.content);
    });
    // 显示聊天窗口
    chatModal.style.display = 'flex';
  });

  // 发送消息
  sendBtn.addEventListener('click', sendMessage);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  function addMessage(role, text) {
    console.log('chat.js: addMessage called, role=', role, 'text=', text, 'msgContainer=', msgContainer);
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-message ' + role;
    msgEl.textContent = text;
    msgContainer.appendChild(msgEl);
    msgContainer.scrollTop = msgContainer.scrollHeight;
  }

  async function sendMessage() {
    console.log('chat.js: sendMessage called');
    const msg = inputEl.value.trim();
    console.log('chat.js: message =', msg);
    if (!msg) return;
    addMessage('user', msg);
    inputEl.value = '';
    try {
      const res = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg })
      });
      const data = await res.json();
      if (data.error) {
        addMessage('error', data.error);
      } else {
        addMessage('assistant', data.message);
      }
    } catch (err) {
      addMessage('error', '发送失败');
    }
  }
}); 