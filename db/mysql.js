const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

// 数据库连接配置
const config = {
  host: 'localhost',
  user: 'root',
  password: 'root',
  database: 'video_platform',
  socketPath: '/var/run/mysqld/mysqld.sock',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

// 创建连接池
const pool = mysql.createPool(config);

// 测试数据库连接并确保数据库存在
async function testConnection() {
  try {
    // 先在不指定数据库的情况下连接，确保 database 存在
    const tempConfig = { ...config };
    delete tempConfig.database;
    const tempPool = mysql.createPool(tempConfig);
    try {
      const [rows] = await tempPool.execute(`SHOW DATABASES LIKE '${config.database}'`);
      if (rows.length === 0) {
        console.log(`数据库 ${config.database} 不存在，正在创建...`);
        await tempPool.execute(`CREATE DATABASE IF NOT EXISTS ${config.database}`);
        console.log(`数据库 ${config.database} 创建成功`);
      }
    } finally {
      await tempPool.end();
    }
    // 验证连接
    const conn = await pool.getConnection();
    console.log('数据库连接成功');
    conn.release();
    return true;
  } catch (error) {
    console.error('数据库连接失败:', error);
    return false;
  }
}

// 执行 SQL 查询
async function query(sql, params = []) {
  try {
    const [rows] = await pool.execute(sql, params);
    return rows;
  } catch (error) {
    console.error('SQL 执行错误:', error);
    throw error;
  }
}

// 初始化数据库，创建所需表
async function initDB() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        role ENUM('user','admin') DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS feedback (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        content TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS videos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        path VARCHAR(255) NOT NULL UNIQUE,
        title VARCHAR(100),
        category VARCHAR(50),
        upload_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS watch_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        video_id INT NOT NULL,
        click_count INT DEFAULT 1,
        progress FLOAT DEFAULT 0,
        completed BOOLEAN DEFAULT FALSE,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
        UNIQUE KEY user_video (user_id, video_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('数据库表创建成功');

    // 初始化管理员账户
    const admins = await query('SELECT id FROM users WHERE username = ?', ['admin']);
    if (admins.length === 0) {
      const hash = bcrypt.hashSync('123456', 10);
      await query(
        'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
        ['admin', hash, 'admin']
      );
      console.log('默认管理员账户创建成功');
    }
    return true;
  } catch (error) {
    console.error('初始化数据库失败:', error);
    return false;
  }
}

module.exports = { query, testConnection, initDB }; 