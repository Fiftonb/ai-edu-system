const fs = require('fs').promises;
const path = require('path');
const bcrypt = require('bcryptjs');

// 数据文件路径
const DB_DIR = path.join(__dirname, '../data');
const USERS_FILE = path.join(DB_DIR, 'users.json');
const FEEDBACK_FILE = path.join(DB_DIR, 'feedback.json');
const VIDEOS_FILE = path.join(DB_DIR, 'videos.json');
const WATCH_HISTORY_FILE = path.join(DB_DIR, 'watch_history.json');

// 确保数据目录和文件存在
async function ensureDbFiles() {
  try {
    await fs.mkdir(DB_DIR, { recursive: true });
    
    const files = [
      { path: USERS_FILE, default: '[]' },
      { path: FEEDBACK_FILE, default: '[]' },
      { path: VIDEOS_FILE, default: '{}' },
      { path: WATCH_HISTORY_FILE, default: '[]' }
    ];

    for (const file of files) {
      try {
        await fs.access(file.path);
      } catch {
        await fs.writeFile(file.path, file.default);
      }
    }
  } catch (error) {
    console.error('初始化数据文件失败:', error);
    throw error;
  }
}

// 读取JSON文件
async function readJsonFile(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`读取文件 ${filePath} 失败:`, error);
    return [];
  }
}

// 写入JSON文件
async function writeJsonFile(filePath, data) {
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`写入文件 ${filePath} 失败:`, error);
    throw error;
  }
}

// 测试连接（兼容性函数）
async function testConnection() {
  try {
    await ensureDbFiles();
    return true;
  } catch (error) {
    console.error('数据库初始化失败:', error);
    return false;
  }
}

// 初始化数据库
async function initDB() {
  try {
    await ensureDbFiles();
    
    // 检查是否存在管理员账户
    const users = await readJsonFile(USERS_FILE);
    const adminExists = users.some(user => user.username === 'admin');
    
    if (!adminExists) {
      const hash = bcrypt.hashSync('123456', 10);
      users.push({
        id: 1,
        username: 'admin',
        password: hash,
        role: 'admin',
        created_at: new Date().toISOString()
      });
      await writeJsonFile(USERS_FILE, users);
      console.log('默认管理员账户创建成功');
    }
    
    return true;
  } catch (error) {
    console.error('初始化数据库失败:', error);
    return false;
  }
}

// 通用查询函数
async function query(operation, params = []) {
  const [action, table] = operation.toLowerCase().split(' ');
  
  try {
    switch (table) {
      case 'users':
        return await handleUsersQuery(action, params);
      case 'feedback':
        return await handleFeedbackQuery(action, params);
      case 'videos':
        return await handleVideosQuery(action, params);
      case 'watch_history':
        return await handleWatchHistoryQuery(action, params);
      default:
        throw new Error(`未知的表名: ${table}`);
    }
  } catch (error) {
    console.error('查询执行错误:', error);
    throw error;
  }
}

// 处理用户相关查询
async function handleUsersQuery(action, params) {
  const users = await readJsonFile(USERS_FILE);
  
  switch (action) {
    case 'select':
      if (params.username) {
        return users.filter(user => user.username === params.username);
      }
      return users;
      
    case 'insert':
      const newUser = {
        id: users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1,
        ...params,
        created_at: new Date().toISOString()
      };
      users.push(newUser);
      await writeJsonFile(USERS_FILE, users);
      return [newUser];

    case 'update':
      const userIndex = users.findIndex(u => u.username === params.username);
      if (userIndex === -1) return [];
      users[userIndex] = { ...users[userIndex], ...params };
      await writeJsonFile(USERS_FILE, users);
      return [users[userIndex]];

    case 'delete':
      const deleteIndex = users.findIndex(u => u.username === params.username);
      if (deleteIndex === -1) return [];
      const deletedUser = users.splice(deleteIndex, 1)[0];
      await writeJsonFile(USERS_FILE, users);
      return [deletedUser];
      
    default:
      throw new Error(`未支持的操作: ${action}`);
  }
}

// 处理反馈相关查询
async function handleFeedbackQuery(action, params) {
  const feedback = await readJsonFile(FEEDBACK_FILE);
  
  switch (action) {
    case 'select':
      if (params.user_id) {
        return feedback.filter(f => f.user_id === params.user_id);
      }
      return feedback;
      
    case 'insert':
      const newFeedback = {
        id: feedback.length > 0 ? Math.max(...feedback.map(f => f.id)) + 1 : 1,
        ...params,
        timestamp: new Date().toISOString()
      };
      feedback.push(newFeedback);
      await writeJsonFile(FEEDBACK_FILE, feedback);
      return [newFeedback];

    case 'delete':
      const deleteIndex = feedback.findIndex(f => f.id === params.id);
      if (deleteIndex === -1) return [];
      const deletedFeedback = feedback.splice(deleteIndex, 1)[0];
      await writeJsonFile(FEEDBACK_FILE, feedback);
      return [deletedFeedback];
      
    default:
      throw new Error(`未支持的操作: ${action}`);
  }
}

// 处理视频相关查询
async function handleVideosQuery(action, params) {
  const videosObj = await readJsonFile(VIDEOS_FILE);
  
  switch (action) {
    case 'select':
      if (params.path) {
        const video = videosObj[params.path];
        return video ? [{ path: params.path, ...video }] : [];
      }
      return Object.entries(videosObj).map(([path, info]) => ({
        path,
        ...info,
        upload_time: info.upload_time || new Date().toISOString()
      }));
      
    case 'insert':
      const { path, title, category } = params;
      videosObj[path] = {
        title,
        category,
        upload_time: new Date().toISOString()
      };
      await writeJsonFile(VIDEOS_FILE, videosObj);
      return [{ path, ...videosObj[path] }];

    case 'delete':
      if (!videosObj[params.path]) return [];
      const deletedVideo = { path: params.path, ...videosObj[params.path] };
      delete videosObj[params.path];
      await writeJsonFile(VIDEOS_FILE, videosObj);
      return [deletedVideo];
      
    default:
      throw new Error(`未支持的操作: ${action}`);
  }
}

// 处理观看历史相关查询
async function handleWatchHistoryQuery(action, params) {
  const history = await readJsonFile(WATCH_HISTORY_FILE);
  
  switch (action) {
    case 'select':
      return history;
      
    case 'insert':
      const newHistory = {
        id: history.length > 0 ? Math.max(...history.map(h => h.id)) + 1 : 1,
        ...params,
        timestamp: new Date().toISOString()
      };
      history.push(newHistory);
      await writeJsonFile(WATCH_HISTORY_FILE, history);
      return [newHistory];
      
    case 'update':
      const index = history.findIndex(h => 
        h.user_id === params.user_id && h.video_id === params.video_id
      );
      if (index !== -1) {
        history[index] = { ...history[index], ...params };
        await writeJsonFile(WATCH_HISTORY_FILE, history);
      }
      return [history[index]];
      
    default:
      throw new Error(`未支持的操作: ${action}`);
  }
}

module.exports = { query, testConnection, initDB }; 