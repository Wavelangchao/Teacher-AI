// ============ 工具函数 ============
// 供所有模块使用的公共工具函数

/**
 * HTML转义，防止XSS
 * 注意：用于HTML属性值时使用escapeAttr，用于HTML内容时使用此函数
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * 安全复制文本到剪贴板（优先使用现代API，回退到传统方式）
 * @param {string} text - 要复制的文本
 * @returns {Promise<boolean>} 是否复制成功
 */
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (e) {
        // 回退方案：使用 textarea 的 select API
        try {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.left = '-9999px';
            textarea.style.top = '-9999px';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            const success = document.execCommand('copy');
            document.body.removeChild(textarea);
            return success;
        } catch (fallbackErr) {
            return false;
        }
    }
}

/**
 * 显示右上角Toast提示
 * @param {string} message - 提示文字
 * @param {'success'|'error'|'info'} type - 提示类型
 */
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast toast-${type}`;
    toast.offsetHeight; // 强制回流
    toast.classList.add('show');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

/**
 * 渲染学生水平等级徽章
 * @param {string} level - 优秀/良好/中等/薄弱
 * @returns {string} HTML字符串
 */
function renderLevelBadge(level) {
    if (!level) return '';
    const lvlColors = { '优秀': '#059669', '良好': '#2563EB', '中等': '#D97706', '薄弱': '#DC2626' };
    const lvlBgColors = { '优秀': '#ECFDF5', '良好': '#EFF6FF', '中等': '#FFFBEB', '薄弱': '#FEF2F2' };
    const color = lvlColors[level] || '#6B7280';
    const bg = lvlBgColors[level] || '#F3F4F6';
    return ` <span style="font-size:10px;background:${bg};color:${color};padding:1px 6px;border-radius:8px;font-weight:600;">${escapeHtml(level)}</span>`;
}

/**
 * 渲染反馈详情HTML（公共函数，消除 viewHistory / viewHistoryInProfile 重复）
 * @param {Object} item - 反馈记录
 * @returns {string} HTML字符串
 */
function renderFeedbackDetail(item) {
    const studentName = item.student_name || '未填写';
    const teaching = item.teaching_content || '流式生成';
    const feedback = item.generated_feedback || '(无内容)';
    const model = item.model_used || 'stream';
    const time = item.created_at || '';
    
    let html = '<div style="font-size:13px;line-height:1.8;">';
    
    // 基本信息区
    html += '<div style="margin-bottom:12px;padding:10px;background:var(--primary-light);border-radius:var(--radius-sm);">';
    html += '<strong>👤 学生：</strong>' + escapeHtml(studentName);
    html += renderLevelBadge(item.student_level);
    if (item.student_grade) {
        html += ' <span style="font-size:10px;background:#F0F9FF;color:#0369A1;padding:1px 6px;border-radius:8px;font-weight:600;">📚 ' + escapeHtml(item.student_grade) + '</span>';
    }
    html += '<br><strong>📖 授课内容：</strong>' + escapeHtml(teaching);
    html += '<br><strong>⏰ 时间：</strong>' + time + ' &nbsp; <span class="model-badge">' + escapeHtml(model) + '</span>';
    
    // Token信息
    if (item.total_tokens > 0) {
        html += '<br><strong>🎫 Token消耗：</strong><span style="color:var(--primary);font-weight:700;">' + item.total_tokens + '</span> (输入: ' + (item.prompt_tokens || 0) + ' + 输出: ' + (item.completion_tokens || 0) + ')';
    } else {
        html += '<br><strong>🎫 Token消耗：</strong><span style="color:var(--text-muted);">0（流式生成，API未返回token数据）</span>';
    }
    html += '</div>';
    
    // 维度信息（从 DIMENSIONS 全局数组中获取标签，消除硬编码重复）
    function getDimLabel(dimId) {
        const dim = DIMENSIONS.find(d => d.id === dimId);
        if (!dim) return dimId;
        // 去掉编号前缀（如 "1. 作业完成情况" → "作业完成情况"）
        return dim.title.replace(/^\d+\.\s*/, '');
    }
    
    const dimFields = [
        'homework_status', 'attention_status', 'interaction_status',
        'drowsy_status', 'daydream_status', 'exercise_status',
        'basic_knowledge', 'skill_speed', 'analysis_ability',
        'calculation_ability', 'study_habit', 'progress_trend',
        'math_thinking'
    ];
    
    const dims = dimFields.map(field => ({
        label: getDimLabel(field),
        value: item[field]
    })).filter(d => d.value && d.value !== '未评价');
    
    if (dims.length > 0) {
        html += '<div style="margin-bottom:12px;padding:10px;background:var(--bg);border-radius:var(--radius-sm);">';
        html += '<strong>📊 评价维度</strong><br>';
        dims.forEach(d => {
            html += '<span style="display:inline-block;background:white;padding:2px 8px;border-radius:10px;margin:2px 4px 2px 0;font-size:12px;border:1px solid var(--border);">' + escapeHtml(d.label) + '：' + escapeHtml(d.value) + '</span>';
        });
        html += '</div>';
    }
    
    // 作业和补充说明
    if (item.homework_assign) {
        html += '<div style="margin-bottom:12px;padding:10px;background:var(--bg);border-radius:var(--radius-sm);">';
        html += '<strong>📝 布置作业：</strong>' + escapeHtml(item.homework_assign);
        html += '</div>';
    }
    if (item.custom_note) {
        html += '<div style="margin-bottom:12px;padding:10px;background:var(--bg);border-radius:var(--radius-sm);">';
        html += '<strong>💬 补充说明：</strong>' + escapeHtml(item.custom_note);
        html += '</div>';
    }
    
    // 反馈正文
    html += '<div style="padding:16px;background:white;border:1px solid var(--border);border-radius:var(--radius-sm);margin-top:12px;">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">';
    html += '<strong style="font-size:15px;">📄 给家长的反馈</strong>';
    html += '<span style="font-size:11px;color:var(--text-muted);">字数：' + (feedback.length || 0) + '</span>';
    html += '</div>';
    html += '<div style="white-space:pre-wrap;font-size:14px;line-height:2;color:var(--text);padding:8px 0;">' + escapeHtml(feedback) + '</div>';
    html += '</div></div>';
    
    return html;
}
