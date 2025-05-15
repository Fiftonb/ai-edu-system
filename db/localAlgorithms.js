/**
 * db/localAlgorithms.js
 * 自研算法替代AI功能
 */

// 视频分类算法：基于关键词匹配的分类系统
function classifyVideoByKeywords(title) {
  // 转为小写以便不区分大小写匹配
  const lowerTitle = title.toLowerCase();
  
  // 英语分类关键词
  const englishKeywords = [
    'a', 'an', 'the', 'is', 'are', 'english', 'grammar', 'vocabulary', 
    'reading', 'writing', 'speaking', 'listening'
  ];
  
  // 数学分类关键词
  const mathKeywords = [
    '数学', '算术', '代数', '几何', '微积分', '方程', '函数', '集合',
    'math', 'algebra', 'geometry', 'calculus', 'equation', 'function'
  ];
  
  // 语文分类关键词
  const chineseKeywords = [
    '语文', '文学', '诗歌', '散文', '小说', '作文', '阅读', '写作',
    '古文', '文言文', '汉语', '拼音', '字词', '句子', '课文'
  ];
  
  // 检查标题是否包含英文单词（任何字母序列）
  if (/[a-zA-Z]+/.test(lowerTitle)) {
    // 进一步确认是否确实是英语内容而非仅含英文字符的其他内容
    for (const keyword of englishKeywords) {
      if (lowerTitle.includes(keyword)) {
        return '英语';
      }
    }
  }
  
  // 检查数学关键词
  for (const keyword of mathKeywords) {
    if (lowerTitle.includes(keyword)) {
      return '数学';
    }
  }
  
  // 检查语文关键词
  for (const keyword of chineseKeywords) {
    if (lowerTitle.includes(keyword)) {
      return '语文';
    }
  }
  
  // 默认分类
  return '其他';
}

// 智能问答系统：基于预设问答对的简单问答系统
const faqDatabase = [
  {
    keywords: ['你好', '你是谁', '介绍'],
    response: '你好！我是视频学习平台的助手，可以帮你解答学习相关的问题。'
  },
  {
    keywords: ['学习', '方法', '技巧'],
    response: '高效学习的方法：1. 集中注意力；2. 定期复习；3. 做好笔记；4. 制定计划；5. 分块学习。'
  },
  {
    keywords: ['数学', '解题'],
    response: '数学解题技巧：1. 理解题目；2. 画图辅助思考；3. 寻找已知条件与目标的联系；4. 尝试多种方法；5. 检查答案。'
  },
  {
    keywords: ['语文', '作文', '写作'],
    response: '写好作文的技巧：1. 积累素材；2. 构思清晰；3. 开头结尾要精彩；4. 多用修辞手法；5. 多读多写多练习。'
  },
  {
    keywords: ['英语', '单词', '记忆'],
    response: '记忆英语单词的方法：1. 分类记忆；2. 联想记忆；3. 场景记忆；4. 重复复习；5. 实际应用。'
  },
  {
    keywords: ['视频', '推荐', '推送'],
    response: '系统会根据您的观看记录和学习习惯自动推荐适合您的视频，建议您多观看一些视频，系统会更了解您的喜好。'
  },
  {
    keywords: ['密码', '忘记', '重置'],
    response: '如果忘记密码，请联系管理员重置。'
  },
  {
    keywords: ['反馈', '建议', '问题'],
    response: '您可以通过页面上的反馈功能提交您的意见和建议，我们会认真听取并改进。'
  },
  {
    keywords: ['谢谢', '感谢'],
    response: '不客气！如果还有其他问题，随时可以向我提问。'
  }
];

// 本地问答算法
function getAnswerByKeywords(question) {
  if (!question || question.trim() === '') {
    return '请输入您的问题，我会尽力回答。';
  }
  
  // 去除标点符号并分词
  const cleanQuestion = question
    .toLowerCase()
    .replace(/[.,?!;:'"()\[\]{}]/g, '')
    .trim();
  
  const words = cleanQuestion.split(/\s+/);
  
  // 为每个FAQ计算匹配度分数
  const matchScores = faqDatabase.map(faq => {
    let score = 0;
    for (const keyword of faq.keywords) {
      if (cleanQuestion.includes(keyword)) {
        score += 2;  // 完整关键词匹配
      } else {
        // 部分关键词匹配
        for (const word of words) {
          if (keyword.includes(word) || word.includes(keyword)) {
            score += 1;
          }
        }
      }
    }
    return { faq, score };
  });
  
  // 找出得分最高的回答
  const bestMatch = matchScores.sort((a, b) => b.score - a.score)[0];
  
  // 如果最高分大于0，返回匹配答案，否则返回默认回答
  return bestMatch && bestMatch.score > 0 
    ? bestMatch.faq.response 
    : '抱歉，我目前无法回答这个问题。请尝试用不同的方式提问，或者咨询其他问题。';
}

// 视频推荐系统：基于用户行为和内容相似度的推荐系统
function recommendVideos(userId, watchHistory, allVideos) {
  // 如果没有视频，返回null
  if (!allVideos || allVideos.length === 0) {
    return null;
  }
  
  // 如果没有观看历史，随机推荐
  if (!watchHistory || watchHistory.length === 0) {
    return allVideos[Math.floor(Math.random() * allVideos.length)];
  }
  
  // 1. 收集用户观看行为数据
  const videoStats = {};
  const userCategories = {};
  
  // 统计用户对每个视频的观看情况
  watchHistory.forEach(record => {
    if (!videoStats[record.video_path]) {
      videoStats[record.video_path] = {
        watchCount: 0,
        completedCount: 0,
        lastWatchTime: 0
      };
    }
    
    // 更新观看统计
    videoStats[record.video_path].watchCount++;
    if (record.completed) {
      videoStats[record.video_path].completedCount++;
    }
    
    // 更新最近观看时间
    const recordTime = new Date(record.timestamp).getTime();
    if (recordTime > videoStats[record.video_path].lastWatchTime) {
      videoStats[record.video_path].lastWatchTime = recordTime;
    }
    
    // 检查这个视频的分类并统计
    const video = allVideos.find(v => v.path === record.video_path);
    if (video && video.category) {
      if (!userCategories[video.category]) {
        userCategories[video.category] = 0;
      }
      userCategories[video.category]++;
    }
  });
  
  // 2. 计算用户偏好分类
  const sortedCategories = Object.keys(userCategories)
    .sort((a, b) => userCategories[b] - userCategories[a]);
  
  const preferredCategory = sortedCategories.length > 0 ? sortedCategories[0] : null;
  
  // 3. 为每个视频计算推荐得分
  const scoredVideos = allVideos.map(video => {
    // 基础得分
    let score = 10;
    
    // 已经完成观看的视频降低得分
    const stats = videoStats[video.path];
    if (stats && stats.completedCount > 0) {
      score -= 5;
    }
    
    // 观看次数多的视频降低得分
    if (stats) {
      score -= Math.min(5, stats.watchCount);
    }
    
    // 优先推荐用户喜欢的分类
    if (preferredCategory && video.category === preferredCategory) {
      score += 3;
    }
    
    // 时间衰减：最近看过的同类视频减分
    const now = Date.now();
    if (stats && stats.lastWatchTime) {
      const daysPassed = (now - stats.lastWatchTime) / (1000 * 60 * 60 * 24);
      if (daysPassed < 1) {
        score -= 2;  // 一天内看过的减分最多
      } else if (daysPassed < 7) {
        score -= 1;  // 一周内看过的稍微减分
      }
    }
    
    return { video, score };
  });
  
  // 4. 根据得分排序并选择得分最高的视频
  scoredVideos.sort((a, b) => b.score - a.score);
  
  // 返回推荐视频
  return scoredVideos[0].video;
}

module.exports = {
  classifyVideoByKeywords,
  getAnswerByKeywords,
  recommendVideos
};
