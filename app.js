const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const ffmpeg = require('fluent-ffmpeg');

// 引入 MySQL 数据库连接和视频初始化脚本
const { query, testConnection, initDB } = require('./db/mysql');

const app = express();
const port = 3001;

// 数据文件路径和初始化
const dataDir = path.join(__dirname, 'data');
const usersFile = path.join(dataDir, 'users.json');
const feedbackFile = path.join(dataDir, 'feedback.json');
const watchFile = path.join(dataDir, 'watch.json');
const videoDataFile = path.join(dataDir, 'videos.json');
// 确保 data 目录存在
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}
// 确保 JSON 文件存在
if (!fs.existsSync(usersFile)) fs.writeFileSync(usersFile, '[]');
if (!fs.existsSync(feedbackFile)) fs.writeFileSync(feedbackFile, '[]');
if (!fs.existsSync(watchFile)) fs.writeFileSync(watchFile, '[]');
if (!fs.existsSync(videoDataFile)) fs.writeFileSync(videoDataFile, '{}');
// 加载视频分类数据
let videoCategories = {};
try {
  videoCategories = JSON.parse(fs.readFileSync(videoDataFile, 'utf8'));
} catch (error) {
  videoCategories = {};
}

// 会话配置
app.use(express.json());
app.use(session({
  secret: 'hero-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// 请求日志，打印所有请求路径和方法
app.use((req, res, next) => {
  console.log(`Request: ${req.method} ${req.path}`);
  next();
});

// 静态资源，只托管静态文件
app.use('/css', express.static(path.join(__dirname, 'public/css')));
app.use('/js', express.static(path.join(__dirname, 'public/js')));
app.use('/images', express.static(path.join(__dirname, 'public/images')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 登录注册页面
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/login.html'));
});
app.get('/register.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/register.html'));
});

// 注册接口
app.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
    }
    // 检查是否存在用户名
    const existing = await query('SELECT id FROM users WHERE username = ?', [username]);
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: '用户名已存在' });
    }
    // 加密并插入数据库
    const hashed = bcrypt.hashSync(password, 10);
    await query('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashed]);
    res.json({ success: true, message: '注册成功' });
  } catch (error) {
    console.error('注册失败:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 登录接口
app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
    }
    const rows = await query('SELECT id, username, password, role FROM users WHERE username = ?', [username]);
    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }
    const user = rows[0];
    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }
    req.session.user = { id: user.id, username: user.username, role: user.role };
    res.json({ success: true, message: '登录成功' });
  } catch (error) {
    console.error('登录失败:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 登出接口
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login.html');
  });
});

// 获取当前用户信息
app.get('/userinfo', authOnly, (req, res) => {
  res.json(req.session.user);
});

// 身份认证中间件
function authOnly(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: '请先登录' });
  }
  next();
}

// 管理员权限中间件
function adminOnly(req, res, next) {
  if (req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  res.status(403).json({ success: false, message: '权限不足' });
}

// 管理后台页面，管理员权限
app.get('/admin.html', adminOnly, (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin.html'));
});

// 主页面
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// 创建上传目录
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// 配置 multer 存储
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// 从视频元数据中提取标题
async function getVideoTitleFromMetadata(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      const tags = metadata && metadata.format && metadata.format.tags;
      const title = tags && (tags.title || tags.TITLE);
      resolve(title || null);
    });
  });
}

// 通用分类函数
async function classifyVideo(title) {
  try {
    const response = await axios.post('https://www.gpt4oapi.com/v1/chat/completions', {
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: `你是一个视频分类助手。只能从以下四个标签中选择一个：语文、数学、英语、其他。
看到任何英文单词就选"英语"。以下是示例：
示例1: 视频标题是:"i love china"，分类:"英语"
示例2: 视频标题是:"朝花夕拾"，分类:"语文"
示例3: 视频标题是:"数学函数基础"，分类:"数学"
只返回标签，不要其他文字。` },
        { role: 'user', content: `视频标题是:"${title}"，请选择一个分类标签。` }
      ],
      temperature: 0.1,
      max_tokens: 20
    }, {
      headers: {
        'Authorization': `Bearer sk-1WRKZt7A1YNYP4Y3ZP4KFeNNQ88j0ZoeUarpHnnzz8f9wa3N`,
        'Content-Type': 'application/json'
      }
    });
    const category = response.data.choices[0].message.content.trim();
    const validCategories = ['语文', '数学', '英语', '其他'];
    return validCategories.includes(category) ? category : '其他';
  } catch (error) {
    console.error('分类错误:', error);
    return '其他';
  }
}

// 上传视频并自动分类
app.post('/upload', upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('未上传文件');
  }

  // 对原始文件名进行 latin1→utf8 解码，处理中文乱码
  const rawName = req.file.originalname;
  const decodedName = Buffer.from(rawName, 'latin1').toString('utf8');
  const videoTitle = path.basename(decodedName, path.extname(decodedName)) || '未命名视频';

  // 使用相对路径，去掉 uploads/ 前缀
  const videoPath = req.file.path.replace('uploads/', '');
  const fullPath = req.file.path;

  try {
    console.log('准备调用 GPT API，视频标题:', videoTitle);
    
    // 使用通用分类函数
    const finalCategory = await classifyVideo(videoTitle);

    // 保存视频路径和分类标签
    videoCategories[fullPath] = {
      title: videoTitle,
      category: finalCategory
    };
    // 持久化更新到文件
    fs.writeFileSync(videoDataFile, JSON.stringify(videoCategories, null, 2));

    // 返回结果给前端
    res.json({
      success: true,
      message: '视频上传成功',
      title: videoTitle,
      videoPath: `uploads/${videoPath}`,
      category: finalCategory,
      // originalResponse 可根据需要删除
    });
  } catch (error) {
    console.error('上传或分类失败:', error.response ? error.response.data : error.message);
    res.status(500).send('上传或分类失败');
  }
});

// 批量上传视频并自动分类
app.post('/uploadBatch', upload.array('videos'), async (req, res) => {
  const files = req.files;
  if (!files || files.length === 0) {
    return res.status(400).json({ success: false, message: '未上传文件' });
  }
  const videoPaths = [];
  const titles = [];
  const categoriesArr = [];
  for (const file of files) {
    // 对原始文件名进行 latin1→utf8 解码，处理中文乱码
    const rawNameBatch = file.originalname;
    const decodedBatchName = Buffer.from(rawNameBatch, 'latin1').toString('utf8');
    const batchTitle = path.basename(decodedBatchName, path.extname(decodedBatchName)) || '未命名视频';
    const category = await classifyVideo(batchTitle);
    videoCategories[file.path] = { title: batchTitle, category: category };
    videoPaths.push(file.path);
    titles.push(batchTitle);
    categoriesArr.push(category);
  }
  // 持久化更新到文件
  fs.writeFileSync(videoDataFile, JSON.stringify(videoCategories, null, 2));
  res.json({ success: true, videoPaths, titles, categories: categoriesArr });
});

// 获取视频分类
app.get('/category/:videoPath', (req, res) => {
  const videoPath = req.params.videoPath;
  const category = videoCategories[videoPath];
  if (category) {
    res.json({ category: category });
  } else {
    res.status(404).send('未找到分类');
  }
});

// 获取所有视频及其分类
app.get('/videos', (req, res) => {
  console.log('GET /videos videoCategories:', videoCategories);
  const videos = Object.entries(videoCategories).map(([videoPath, info]) => {
    let title, category;
    // 兼容旧版本仅存储分类字符串的情况
    if (info && typeof info === 'object') {
      title = info.title || '未命名视频';
      category = info.category;
    } else {
      title = '未命名视频';
      category = info;
    }
    // 从文件名中解析上传时间戳
    const uploadTime = Number(path.basename(videoPath, path.extname(videoPath)));
    return { path: videoPath, title, category, uploadTime };
  });
  res.json(videos);
});

// 删除视频接口，基于查询参数 path
app.delete('/video', (req, res) => {
  const videoPath = req.query.path;
  // 检查视频是否存在
  if (!videoPath || !videoCategories[videoPath]) {
    return res.status(404).send('未找到视频');
  }
  // 删除文件
  const filePath = path.join(__dirname, videoPath);
  fs.unlink(filePath, (err) => {
    if (err) {
      console.error('删除文件失败:', err);
      return res.status(500).send('删除文件失败');
    }

    // 删除存储的信息
    delete videoCategories[videoPath];
    // 持久化更新到文件
    fs.writeFileSync(videoDataFile, JSON.stringify(videoCategories, null, 2));
    res.json({ success: true, message: '视频删除成功' });
  });
});

// AI 对话接口
app.post('/chat', async (req, res) => {
  const message = req.body.message;
  if (!message) {
    return res.status(400).json({ error: '消息不能为空' });
  }
  // 初始化会话历史
  if (!req.session.chatHistory) {
    req.session.chatHistory = [{ role: 'system', content: '你是一个友好的 AI 助手，请回答用户的问题。' }];
  }
  // 添加用户消息
  req.session.chatHistory.push({ role: 'user', content: message });
  try {
    const response = await axios.post('https://www.gpt4oapi.com/v1/chat/completions', {
      model: 'gpt-3.5-turbo',
      messages: req.session.chatHistory,
      temperature: 0.7,
      max_tokens: 500
    }, {
      headers: {
        'Authorization': 'Bearer sk-1WRKZt7A1YNYP4Y3ZP4KFeNNQ88j0ZoeUarpHnnzz8f9wa3N',
        'Content-Type': 'application/json'
      }
    });
    const aiMessage = response.data.choices[0].message.content.trim();
    // 添加 AI 回复到历史
    req.session.chatHistory.push({ role: 'assistant', content: aiMessage });
    res.json({ message: aiMessage });
  } catch (error) {
    console.error('AI 对话错误:', error.response ? error.response.data : error.message);
    res.status(500).json({ error: 'AI 对话失败' });
  }
});

// 重置 AI 会话历史
app.post('/chat/reset', (req, res) => {
  req.session.chatHistory = null;
  res.json({ success: true });
});

// 获取 AI 会话历史（不含系统角色）
app.get('/chat/history', (req, res) => {
  const history = req.session.chatHistory || [];
  // 过滤掉系统消息
  const userHistory = history.filter(msg => msg.role !== 'system');
  res.json(userHistory);
});

// 用户反馈：提交反馈
app.post('/feedback', (req, res) => {
  const user = req.session.user;
  const { content } = req.body;
  if (!user) return res.status(401).json({ success: false, message: '未登录' });
  if (!content || typeof content !== 'string') return res.status(400).json({ success: false, message: '反馈内容不能为空' });
  const feedbacks = JSON.parse(fs.readFileSync(feedbackFile, 'utf8'));
  const item = { username: user.username, content, timestamp: Date.now() };
  feedbacks.push(item);
  fs.writeFileSync(feedbackFile, JSON.stringify(feedbacks, null, 2));
  res.json({ success: true });
});

// 用户反馈：获取当前用户历史反馈
app.get('/feedback', (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json({ success: false, message: '未登录' });
  const feedbacks = JSON.parse(fs.readFileSync(feedbackFile, 'utf8'));
  const userList = feedbacks.filter(f => f.username === user.username).sort((a, b) => b.timestamp - a.timestamp);
  res.json(userList);
});

// ----- 学习数据模块 -----
// 记录用户观看历史
app.post('/watch-history', (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json({ success: false, message: '未登录' });
  // 支持 completed（boolean）和 progress（0~1 数值）
  const { videoPath, completed, progress } = req.body;
  if (!videoPath || typeof completed !== 'boolean' || (progress !== undefined && typeof progress !== 'number')) {
    return res.status(400).json({ success: false, message: '参数错误' });
  }
  const records = JSON.parse(fs.readFileSync(watchFile, 'utf8'));
  const record = { username: user.username, videoPath, completed, timestamp: Date.now() };
  if (typeof progress === 'number') record.progress = progress;
  records.push(record);
  fs.writeFileSync(watchFile, JSON.stringify(records, null, 2));
  res.json({ success: true });
});

// 获取学习进度报告，统计每个视频点击次数和最高播放进度
app.get('/report/progress', (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json({ success: false, message: '未登录' });
  const username = user.username;
  const allRecords = JSON.parse(fs.readFileSync(watchFile, 'utf8'));
  const userRecords = allRecords.filter(r => r.username === username);
  // 按视频聚合记录
  const map = {};
  userRecords.forEach(r => {
    if (!map[r.videoPath]) map[r.videoPath] = [];
    map[r.videoPath].push(r);
  });
  // 仅统计有记录的视频，并包含标题
  const details = Object.entries(map).map(([videoPath, recs]) => {
    // 获取视频标题
    const title = (videoCategories[videoPath] && videoCategories[videoPath].title) || path.basename(videoPath);
    // 点击次数：仅统计未完播且未上报progress的记录（play事件）
    const clickCount = recs.filter(r => r.completed === false && r.progress === undefined).length;
    const highestProgress = recs.some(r => r.completed)
      ? 1
      : recs.reduce((max, r) => {
        return Math.max(max, typeof r.progress === 'number' ? r.progress : 0);
      }, 0);
    const lastTimestamp = recs.length > 0
      ? recs.reduce((max, r) => r.timestamp > max ? r.timestamp : max, recs[0].timestamp)
      : null;
    return { videoPath, title, clickCount, highestProgress, timestamp: lastTimestamp };
  });
  res.json({ success: true, report: { details } });
});

// 新增：初始化学习记录（清空所有记录）
app.delete('/watch-history', (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json({ success: false, message: '未登录' });
  // 清空学习记录文件
  fs.writeFileSync(watchFile, '[]');
  res.json({ success: true });
});

// 视频推荐接口
app.get('/recommendation', async (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json({ success: false, message: '未登录' });
  // 汇总数据
  const watchData = JSON.parse(fs.readFileSync(watchFile, 'utf8')).filter(r => r.username === user);
  const videos = Object.entries(videoCategories).map(([path, info]) => ({ videoPath: path, title: info.title }));
  const historyText = watchData.map(r => `${r.videoPath}，已看完：${r.completed}`).join('\n') || '无观看记录';
  const videoText = videos.map(v => v.title).join('\n');
  try {
    // 计算学习进度统计
    const allRecords = JSON.parse(fs.readFileSync(watchFile, 'utf8')).filter(r => r.username === user);
    const progressMap = {};
    allRecords.forEach(r => { if (!progressMap[r.videoPath]) progressMap[r.videoPath] = []; progressMap[r.videoPath].push(r); });
    const progressDetails = Object.entries(progressMap).map(([videoPath, recs]) => {
      const title = (videoCategories[videoPath] && videoCategories[videoPath].title) || path.basename(videoPath);
      const clickCount = recs.filter(r => r.completed === false && r.progress === undefined).length;
      const highestProgress = recs.some(r => r.completed)
        ? 1
        : recs.reduce((max, r) => Math.max(max, typeof r.progress === 'number' ? r.progress : 0), 0);
      return `视频标题: ${title}，点击次数: ${clickCount}，最高进度: ${(highestProgress*100).toFixed(2)}%`;
    });
    const progressText = progressDetails.length > 0 ? progressDetails.join('\n') : '无学习记录';
    const aiRes = await axios.post('https://www.gpt4oapi.com/v1/chat/completions', {
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: '你是一个视频推荐系统，根据用户的学习进度和可选视频列表推荐下一个视频。只返回视频标题。' },
        { role: 'user', content: `用户：${user}\n学习进度：\n${progressText}\n可选视频：\n${videoText}\n请选择一个最合适的视频。` }
      ],
      temperature: 0.2,
      max_tokens: 50
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY || 'sk-1WRKZt7A1YNYP4Y3ZP4KFeNNQ88j0ZoeUarpHnnzz8f9wa3N'}`,
        'Content-Type': 'application/json'
      }
    });
    const recTitle = aiRes.data.choices[0].message.content.trim();
    // 精确匹配
    let recVideo = videos.find(v => v.title === recTitle);
    // 尝试模糊匹配
    if (!recVideo) {
      recVideo = videos.find(v => recTitle.includes(v.title) || v.title.includes(recTitle));
    }
    if (recVideo) {
      res.json({ success: true, recommendation: recVideo });
    } else {
      // 后备随机推荐
      const fallback = videos[Math.floor(Math.random() * videos.length)];
      res.json({ success: true, recommendation: fallback, note: '未能精确匹配AI返回，已随机推荐' });
    }
  } catch (error) {
    console.error('推荐系统错误：', error);
    res.status(500).json({ success: false, message: '推荐失败' });
  }
});

// MySQL 后台用户管理接口
app.get('/admin/users', adminOnly, async (req, res) => {
  try {
    const users = await query('SELECT username, role, created_at AS createdAt FROM users');
    res.json(users);
  } catch (error) {
    console.error('获取用户列表失败:', error);
    res.status(500).json({ success: false, message: '获取用户列表失败' });
  }
});

app.put('/admin/user/:username/role', adminOnly, async (req, res) => {
  const usernameParam = req.params.username;
  const { role } = req.body;
  if (!['admin', 'user'].includes(role)) {
    return res.status(400).json({ success: false, message: '无效角色' });
  }
  try {
    const result = await query('UPDATE users SET role = ? WHERE username = ?', [role, usernameParam]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('修改用户角色失败:', error);
    res.status(500).json({ success: false, message: '修改用户角色失败' });
  }
});

app.delete('/admin/user/:username', adminOnly, async (req, res) => {
  const usernameParam = req.params.username;
  try {
    const result = await query('DELETE FROM users WHERE username = ?', [usernameParam]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('删除用户失败:', error);
    res.status(500).json({ success: false, message: '删除用户失败' });
  }
});

// 新增：删除用户反馈
app.delete('/admin/feedback/:timestamp', adminOnly, (req, res) => {
  const timestampParam = Number(req.params.timestamp);
  let feedbacksArray = JSON.parse(fs.readFileSync(feedbackFile, 'utf8'));
  const idx = feedbacksArray.findIndex(f => f.timestamp === timestampParam);
  if (idx === -1) return res.status(404).json({ success: false, message: '反馈不存在' });
  feedbacksArray.splice(idx, 1);
  fs.writeFileSync(feedbackFile, JSON.stringify(feedbacksArray, null, 2));
  res.json({ success: true });
});

// 管理端获取所有反馈
app.get('/admin/feedback', adminOnly, (req, res) => {
  const feedbacks = JSON.parse(fs.readFileSync(feedbackFile, 'utf8'));
  feedbacks.sort((a, b) => b.timestamp - a.timestamp);
  res.json(feedbacks);
});

// 启动服务器
async function startServer() {
  try {
    // 测试数据库连接
    await testConnection();
    
    // 初始化数据库表
    await initDB();
    
    // 启动服务器
    app.listen(port, () => {
      console.log('服务器已启动，端口：' + port);
    });
  } catch (error) {
    console.error('启动服务器失败:', error);
  }
}

startServer();