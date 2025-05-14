# 视频学习平台

## 项目简介
这是一个基于 Node.js 和 Express 的视频学习平台，集成了视频上传、自动分类、学习进度跟踪、反馈、AI 聊天助手及视频推荐等功能。

## 功能特性
- 视频上传与自动分类
- 学习进度跟踪与报告
- 用户反馈模块
- AI 聊天助手
- 视频推荐系统
- 管理后台（用户与反馈管理）

## 技术栈
- 后端：Node.js, Express
- 前端：HTML, CSS, JavaScript
- 数据存储：本地 JSON 文件
- AI 接口：OpenAI Chat API
- 会话管理：express-session

## 安装与运行
1. 克隆仓库：
   ```bash
   git clone <仓库地址>
   cd <项目目录>
   ```
2. 安装依赖：
   ```bash
   npm install
   ```
3. 启动服务：
   ```bash
   node app.js
   ```
4. 浏览器访问：http://localhost:3001

## 环境变量
- 可选：设置 `OPENAI_API_KEY` 以使用自定义的 OpenAI API Key
  ```bash
  export OPENAI_API_KEY=your_api_key
  ```

## 忽略文件
请参考 `.gitignore` 文件。

## 许可协议
MIT License 