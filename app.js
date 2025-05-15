const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const session = require('express-session');
const bcrypt = require('bcryptjs');

// 引入 JSON 数据库连接和初始化脚本
const { query, testConnection, initDB } = require('./db/jsondb');
// 引入本地算法，替代AI功能
const { classifyVideoByKeywords, getAnswerByKeywords, recommendVideos } = require('./db/localAlgorithms');

const app = express();
const port = 3001;

// 数据文件路径和初始化
const dataDir = path.join(__dirname, 'data');
const feedbackFile = path.join(dataDir, 'feedback.json');
const watchHistoryFile = path.join(dataDir, 'watch_history.json');
const videoDataFile = path.join(dataDir, 'videos.json');
// 确保 data 目录存在
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}
// 确保 JSON 文件存在
if (!fs.existsSync(feedbackFile)) fs.writeFileSync(feedbackFile, '[]');
if (!fs.existsSync(watchHistoryFile)) fs.writeFileSync(watchHistoryFile, '[]');
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
    const existing = await query('select users', { username });
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: '用户名已存在' });
    }
    // 加密并插入数据库
    const hashed = bcrypt.hashSync(password, 10);
    await query('insert users', { username, password: hashed, role: 'user' });
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
    const rows = await query('select users', { username });
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

// 通用分类函数
async function classifyVideo(title) {
  try {
    console.log('使用本地算法分类视频:', title);
    return classifyVideoByKeywords(title);
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

  try {
    console.log('准备调用 GPT API，视频标题:', videoTitle);
    
    // 使用通用分类函数
    const finalCategory = await classifyVideo(videoTitle);

    // 保存视频信息到数据库
    const videoResult = await query('insert videos', {
      path: videoPath,
      title: videoTitle,
      category: finalCategory
    });

    // 返回结果给前端
    res.json({
      success: true,
      message: '视频上传成功',
      title: videoTitle,
      videoPath: `uploads/${videoPath}`,
      category: finalCategory
    });
  } catch (error) {
    console.error('上传或分类失败:', error.response ? error.response.data : error.message);
    // 删除已上传的文件
    fs.unlink(req.file.path, () => {});
    res.status(500).send('上传或分类失败');
  }
});

// 批量上传视频并支持手动分类
app.post('/uploadBatch', upload.array('videos'), async (req, res) => {
  const files = req.files;
  const selectedCategory = req.body.category; // 获取手动选择的分类
  
  if (!files || files.length === 0) {
    return res.status(400).json({ success: false, message: '未上传文件' });
  }

  try {
    const results = await Promise.all(files.map(async (file) => {
      const rawNameBatch = file.originalname;
      const decodedBatchName = Buffer.from(rawNameBatch, 'latin1').toString('utf8');
      const batchTitle = path.basename(decodedBatchName, path.extname(decodedBatchName)) || '未命名视频';
      
      // 使用手动选择的分类，如果没有则自动分类
      const category = selectedCategory || await classifyVideo(batchTitle);
      
      // 使用相对路径，去掉 uploads/ 前缀
      const videoPath = path.basename(file.path);
      
      const videoResult = await query('insert videos', {
        path: videoPath,
        title: batchTitle,
        category: category
      });

      return {
        path: videoPath,
        title: batchTitle,
        category: category
      };
    }));

    res.json({
      success: true,
      videos: results
    });
  } catch (error) {
    console.error('批量上传失败:', error);
    // 删除已上传的文件
    files.forEach(file => fs.unlink(file.path, () => {}));
    res.status(500).json({ success: false, message: '批量上传失败' });
  }
});

// 获取视频分类
app.get('/category/:videoPath', async (req, res) => {
  try {
    const videoPath = req.params.videoPath;
    const videos = await query('select videos', { path: videoPath });
    if (videos.length > 0) {
      res.json({ category: videos[0].category });
    } else {
      res.status(404).send('未找到分类');
    }
  } catch (error) {
    console.error('获取分类失败:', error);
    res.status(500).send('获取分类失败');
  }
});

// 获取所有视频及其分类
app.get('/videos', async (req, res) => {
  try {
    const videos = await query('select videos');
    const formattedVideos = videos.map(video => ({
      path: video.path,
      title: video.title || '未命名视频',
      category: video.category,
      uploadTime: new Date(video.upload_time).getTime()
    }));
    res.json(formattedVideos);
  } catch (error) {
    console.error('获取视频列表失败:', error);
    res.status(500).send('获取视频列表失败');
  }
});

// 删除视频接口
app.delete('/video', async (req, res) => {
  const videoPath = req.query.path;
  try {
    console.log('删除视频请求:', videoPath);
    
    const result = await query('delete videos', { path: videoPath });
    console.log('删除数据库结果:', result);
    
    if (!result || result.length === 0) {
      return res.status(404).send('未找到视频');
    }

    // 删除文件
    const filePath = path.join(uploadDir, path.basename(videoPath));
    console.log('删除文件路径:', filePath);
    
    try {
      await fs.promises.unlink(filePath);
      console.log('文件删除成功');
    } catch (fileError) {
      console.error('文件删除失败:', fileError);
      // 文件删除失败不影响整体结果
    }
    
    res.json({ success: true, message: '视频删除成功' });
  } catch (error) {
    console.error('删除视频失败:', error);
    res.status(500).send('删除视频失败');
  }
});

// AI 对话接口改为本地问答系统
app.post('/chat', async (req, res) => {
  const message = req.body.message;
  if (!message) {
    return res.status(400).json({ error: '消息不能为空' });
  }
  
  // 初始化会话历史
  if (!req.session.chatHistory) {
    req.session.chatHistory = [];
  }
  
  // 添加用户消息
  req.session.chatHistory.push({ role: 'user', content: message });
  
  try {
    // 使用本地问答系统
    const answer = getAnswerByKeywords(message);
    
    // 添加回复到历史
    req.session.chatHistory.push({ role: 'assistant', content: answer });
    
    res.json({ message: answer });
  } catch (error) {
    console.error('对话错误:', error);
    res.status(500).json({ error: '对话失败' });
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
app.post('/feedback', async (req, res) => {
  const user = req.session.user;
  const { content } = req.body;
  if (!user) return res.status(401).json({ success: false, message: '未登录' });
  if (!content || typeof content !== 'string') return res.status(400).json({ success: false, message: '反馈内容不能为空' });
  
  try {
    await query('insert feedback', { user_id: user.id, content });
    res.json({ success: true });
  } catch (error) {
    console.error('提交反馈失败:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 用户反馈：获取当前用户历史反馈
app.get('/feedback', async (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json({ success: false, message: '未登录' });
  
  try {
    const feedbacks = await query('select feedback', { user_id: user.id });
    res.json(feedbacks.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)));
  } catch (error) {
    console.error('获取反馈失败:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// ----- 学习数据模块 -----
// 记录用户观看历史
app.post('/watch-history', async (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json({ success: false, message: '未登录' });
  
  const { videoPath, completed, progress } = req.body;
  if (!videoPath || typeof completed !== 'boolean' || (progress !== undefined && typeof progress !== 'number')) {
    return res.status(400).json({ success: false, message: '参数错误' });
  }

  try {
    await query('insert watch_history', {
      user_id: user.id,
      video_path: videoPath,
      completed,
      progress: progress || 0
    });
    res.json({ success: true });
  } catch (error) {
    console.error('记录观看历史失败:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取学习进度报告
app.get('/report/progress', async (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json({ success: false, message: '未登录' });

  try {
    const history = await query('select watch_history', { user_id: user.id });
    const videos = await query('select videos');

    // 按视频聚合记录
    const progressMap = {};
    history.forEach(record => {
      if (!progressMap[record.video_path]) {
        progressMap[record.video_path] = {
          clickCount: 0,
          highestProgress: 0,
          lastTimestamp: null
        };
      }
      const stats = progressMap[record.video_path];
      
      if (!record.completed && !record.progress) {
        stats.clickCount++;
      }
      if (record.completed) {
        stats.highestProgress = 1;
      } else if (record.progress > stats.highestProgress) {
        stats.highestProgress = record.progress;
      }
      const timestamp = new Date(record.timestamp).getTime();
      if (!stats.lastTimestamp || timestamp > stats.lastTimestamp) {
        stats.lastTimestamp = timestamp;
      }
    });

    // 生成报告
    const details = Object.entries(progressMap).map(([videoPath, stats]) => {
      const video = videos.find(v => v.path === videoPath);
      return {
        videoPath,
        title: video ? video.title : path.basename(videoPath),
        clickCount: stats.clickCount,
        highestProgress: stats.highestProgress,
        timestamp: stats.lastTimestamp
      };
    });

    res.json({ success: true, report: { details } });
  } catch (error) {
    console.error('获取学习进度报告失败:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 新增：初始化学习记录（清空所有记录）
app.delete('/watch-history', async (req, res) => {
  try {
    const user = req.session.user;
    if (!user) return res.status(401).json({ success: false, message: '未登录' });
    
    console.log('清空学习记录');
    
    // 使用 JSON 数据库清空学习记录
    // 方法1: 从数据库中删除记录
    const { query } = require('./db/jsondb');
    
    // 方法2: 直接写入空数组
    await fs.promises.writeFile(watchHistoryFile, '[]');
    
    console.log('学习记录已清空');
    res.json({ success: true, message: '学习记录已清空' });
  } catch (error) {
    console.error('清空学习记录失败:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 视频推荐接口 (使用本地算法)
app.get('/recommendation', async (req, res) => {
  try {
    const user = req.session.user;
    if (!user) return res.status(401).json({ success: false, message: '未登录' });
    
    console.log('获取视频推荐，用户:', user.username);
    
    // 获取观看历史
    const watchHistory = await query('select watch_history', { user_id: user.id });
    console.log('观看历史记录数:', watchHistory.length);
    
    // 获取视频列表
    const videos = await query('select videos');
    console.log('视频总数:', videos.length);
    
    if (videos.length === 0) {
      return res.json({ 
        success: true, 
        recommendation: null,
        message: '暂无可推荐视频'
      });
    }
    
    // 使用本地推荐算法
    const recommendation = recommendVideos(user.id, watchHistory, videos);
    
    if (!recommendation) {
      return res.json({
        success: true,
        recommendation: null,
        message: '没有合适的推荐视频'
      });
    }
    
    console.log('推荐视频:', recommendation.title);
    
    res.json({ 
      success: true, 
      recommendation: {
        videoPath: `/uploads/${recommendation.path}`,
        title: recommendation.title
      }
    });
  } catch (error) {
    console.error('视频推荐失败:', error);
    res.status(500).json({ success: false, message: '推荐失败' });
  }
});

// MySQL 后台用户管理接口改为JSON存储
app.get('/admin/users', adminOnly, async (req, res) => {
  try {
    const users = await query('select users');
    res.json(users.map(user => ({
      username: user.username,
      role: user.role,
      createdAt: user.created_at
    })));
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
    const result = await query('update users', { username: usernameParam, role });
    if (!result || result.length === 0) {
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
    const result = await query('delete users', { username: usernameParam });
    if (!result || result.length === 0) {
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

// 修改视频分类
app.put('/video/:videoPath/category', async (req, res) => {
  try {
    const { videoPath } = req.params;
    const { category } = req.body;
    console.log('修改视频分类:', videoPath, category);
    
    // 验证分类
    const validCategories = ['语文', '数学', '英语', '其他'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ success: false, message: '无效的分类' });
    }
    
    // 获取当前视频
    const videos = await query('select videos', { path: videoPath });
    if (videos.length === 0) {
      return res.status(404).json({ success: false, message: '视频不存在' });
    }
    
    // 读取视频对象
    const videosObj = JSON.parse(fs.readFileSync(videoDataFile, 'utf8'));
    
    // 更新分类
    if (videosObj[videoPath]) {
      videosObj[videoPath].category = category;
      fs.writeFileSync(videoDataFile, JSON.stringify(videosObj, null, 2));
      res.json({ success: true, message: '分类更新成功' });
    } else {
      res.status(404).json({ success: false, message: '视频不存在' });
    }
  } catch (error) {
    console.error('更新分类失败:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取所有分类
app.get('/admin/categories', adminOnly, async (req, res) => {
  try {
    // 从配置文件读取分类
    const categoriesConfig = JSON.parse(fs.readFileSync(path.join(dataDir, 'categories.json'), 'utf8'));
    res.json({ success: true, categories: categoriesConfig.categories });
  } catch (error) {
    // 如果文件不存在，返回默认分类
    const defaultCategories = ['语文', '数学', '英语', '其他'];
    // 创建默认配置文件
    fs.writeFileSync(
      path.join(dataDir, 'categories.json'), 
      JSON.stringify({ categories: defaultCategories }, null, 2)
    );
    res.json({ success: true, categories: defaultCategories });
  }
});

// 更新分类列表
app.put('/admin/categories', adminOnly, async (req, res) => {
  try {
    const { categories } = req.body;
    
    // 验证新分类列表
    if (!Array.isArray(categories) || categories.length === 0) {
      return res.status(400).json({ success: false, message: '分类列表格式错误' });
    }
    
    // 确保包含"其他"分类
    if (!categories.includes('其他')) {
      categories.push('其他');
    }
    
    // 保存新的分类列表
    fs.writeFileSync(
      path.join(dataDir, 'categories.json'),
      JSON.stringify({ categories }, null, 2)
    );
    
    res.json({ success: true, message: '分类更新成功' });
  } catch (error) {
    console.error('更新分类失败:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取分类统计信息
app.get('/admin/categories/stats', adminOnly, async (req, res) => {
  try {
    const videos = await query('select videos');
    const stats = {};
    videos.forEach(video => {
      if (!stats[video.category]) {
        stats[video.category] = 0;
      }
      stats[video.category]++;
    });
    res.json({ success: true, stats });
  } catch (error) {
    console.error('获取分类统计失败:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 批量更新视频分类
app.put('/admin/categories/batch', adminOnly, async (req, res) => {
  try {
    const { oldCategory, newCategory } = req.body;
    const validCategories = ['语文', '数学', '英语', '其他'];
    
    if (!validCategories.includes(newCategory)) {
      return res.status(400).json({ success: false, message: '无效的分类' });
    }

    const videos = await query('select videos');
    let updateCount = 0;
    
    for (const video of videos) {
      if (video.category === oldCategory) {
        const videoPath = video.path;
        const videosObj = JSON.parse(fs.readFileSync(videoDataFile, 'utf8'));
        if (videosObj[videoPath]) {
          videosObj[videoPath].category = newCategory;
          updateCount++;
        }
        await fs.promises.writeFile(videoDataFile, JSON.stringify(videosObj, null, 2));
      }
    }
    
    res.json({ 
      success: true, 
      message: `成功更新 ${updateCount} 个视频的分类` 
    });
  } catch (error) {
    console.error('批量更新分类失败:', error);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 公共接口：获取所有分类
app.get('/categories', async (req, res) => {
  try {
    // 从配置文件读取分类
    const categoriesConfig = JSON.parse(fs.readFileSync(path.join(dataDir, 'categories.json'), 'utf8'));
    res.json({ success: true, categories: categoriesConfig.categories });
  } catch (error) {
    // 如果文件不存在，返回默认分类
    const defaultCategories = ['语文', '数学', '英语', '其他'];
    res.json({ success: true, categories: defaultCategories });
  }
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