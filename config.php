<?php
/**
 * 教师课后反馈系统 - 配置文件
 */

// 强制设置中国时区（避免服务器PHP时区与系统时区不一致）
date_default_timezone_set('Asia/Shanghai');

// 数据库配置（使用SQLite，无需额外安装数据库）
define('DB_PATH', __DIR__ . '/data/feedback.db');

// 默认千问API配置
define('DEFAULT_API_KEY', '');
define('DEFAULT_MODEL', 'qwen-plus');
define('DEFAULT_TEMPERATURE', 0.7);
define('DEFAULT_MAX_TOKENS', 2000);

// 可用的千问模型列表（完整说明）
// 模型名称参考：https://help.aliyun.com/zh/model-studio/getting-started/models
define('AVAILABLE_MODELS', [
    'qwen-turbo'            => 'Qwen-Turbo（速度最快，成本最低，适合简单日常场景）',
    'qwen-plus'             => 'Qwen-Plus（效果与速度均衡，适合大多数教学场景）⭐推荐',
    'qwen-max'              => 'Qwen-Max（效果最佳，适合高质量要求的复杂反馈）',
    'qwen-long'             => 'Qwen-Long（支持100万tokens长文本，适合批量处理）',
    'qwen-plus-latest'      => 'Qwen-Plus-Latest（始终指向最新Plus版本，自动更新）',
    'qwen-max-latest'       => 'Qwen-Max-Latest（始终指向最新Max版本，自动更新）🔥',
    'qwen3.6-flash'         => 'Qwen3.6-Flash（新一代轻量模型，速度与性价比兼得）',
    'qwen3.7-plus'          => 'Qwen3.7-Plus（最新Plus旗舰，推理能力全面升级）',
]);

// 千问API地址
define('QWEN_API_URL', 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');

// ============ 评价维度统一配置 ============
// 定义所有维度及其数据库字段名、中文标签，消除各处重复定义
define('DIMENSION_KEYS', [
    'homework_status'    => '作业完成情况',
    'attention_status'   => '听课状态',
    'interaction_status' => '课堂互动',
    'drowsy_status'      => '犯困情况',
    'daydream_status'    => '溜号情况',
    'exercise_status'    => '随堂练习',
    'basic_knowledge'    => '基础知识',
    'formula_mastery'    => '公式掌握情况',
    'skill_speed'        => '做题技巧与速度',
    'analysis_ability'   => '解题思路分析',
    'calculation_ability'=> '计算能力',
    'study_habit'        => '学习习惯',
    'progress_trend'     => '进步趋势（与之前对比）',
    'math_thinking'      => '数学思维能力',
]);

/**
 * 从输入数据中提取已填写的维度（值不为空且不为"未评价"）
 * @return array [dimKey => value, ...]
 */
function buildDimensionMap($input) {
    $map = [];
    foreach (DIMENSION_KEYS as $key => $label) {
        $value = $input[$key] ?? '';
        if ($value && $value !== '未评价') {
            $map[$key] = $value;
        }
    }
    return $map;
}

/**
 * 构建维度列表字符串（用于 prompt）
 * @return string 如 "· 作业完成情况：xxx\n· 听课状态：xxx"
 */
function buildDimensionLines($dimensionMap) {
    $lines = [];
    foreach ($dimensionMap as $key => $value) {
        $label = DIMENSION_KEYS[$key] ?? $key;
        $lines[] = "· {$label}：{$value}";
    }
    return implode("\n", $lines);
}

/**
 * 获取学生最近一次反馈的生成内容（用于进步对比）
 * @param string $studentName 学生姓名
 * @return string|null 最近一次反馈文本，没有则返回 null
 */
function getLastFeedback($studentName) {
    if (empty($studentName)) return null;
    $db = getDB();
    $stmt = $db->prepare("SELECT generated_feedback, teaching_content, created_at FROM feedback_history WHERE student_name = :name ORDER BY id DESC LIMIT 1");
    $stmt->bindValue(':name', $studentName, SQLITE3_TEXT);
    $row = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
    return $row ? $row['generated_feedback'] : null;
}

/**
 * 根据学生年级构建知识范围约束提示（用于 prompt，不体现在反馈正文中）
 * 
 * 核心原则：
 * - 约束的是 AI 在"给建议"时不要推荐超纲方法，不是约束授课内容
 * - 授课内容由教师填写，AI 不评价是否超纲
 * - 如果授课内容本身就覆盖了该年级的知识点（如初三复习初一内容），这是正常的，不算超纲
 * - 但如果授课内容是"一元一次方程"，AI 不应在建议里写"多练一元二次方程"
 *
 * @param string $grade 年级（如"初一"、"小四"）
 * @param string $teaching 授课内容（用于判断是否已涉及更高知识点）
 * @return string 约束提示文本
 */
// 年级知识范围配置（便于维护和更新教材大纲）
define('GRADE_KNOWLEDGE', [
    '小一' => '学生处于小学一年级，数学知识限于20以内加减法和基本图形认识。',
    '小二' => '学生处于小学二年级，数学知识限于100以内加减、简单乘法口诀、长度单位。',
    '小三' => '学生处于小学三年级，数学知识限于万以内加减、多位数乘除法、分数初步、周长面积基础。',
    '小四' => '学生处于小学四年级，数学知识限于大数运算、运算律、角的度量、基本统计图表。',
    '小五' => '学生处于小学五年级，数学知识限于小数乘除、简易方程、多边形面积、因数与倍数。',
    '小六' => '学生处于小学六年级，数学知识限于分数乘除、百分数、比和比例、圆的基础、负数初步。',
    '初一' => '学生处于初中一年级，数学知识限于有理数、整式加减、一元一次方程、二元一次方程组、不等式、基本几何（线与角、平行线）。尚未学习：函数、勾股定理、因式分解。',
    '初二' => '学生处于初中二年级，数学知识限于全等三角形、一次函数、因式分解、分式、二次根式、勾股定理、平行四边形。尚未学习：二次函数、圆的性质、相似三角形、锐角三角函数。',
    '初三' => '学生处于初中三年级，已覆盖初中全部数学知识（二次函数、圆、相似、锐角三角比、概率统计等）。尚未学习：高中集合与函数概念。',
    '高一' => '学生处于高中一年级，数学知识限于集合、常用逻辑用语、不等式、函数概念与性质、指数对数函数、三角函数。尚未学习：数列、导数、概率分布、空间向量。',
    '高二' => '学生处于高中二年级，已覆盖大部分高中数学（数列、导数、概率、空间向量、解析几何）。尚未学习：高等数学内容。',
    '高三' => '学生处于高中三年级，已覆盖高中数学全部内容，以综合复习为主。',
]);

function buildGradeConstraint($grade, $teaching = '') {
    $gradeKnowledge = GRADE_KNOWLEDGE;

    $knowledge = $gradeKnowledge[$grade] ?? null;
    if (!$knowledge) return '';

    // 构建约束：不体现在反馈正文中
    $constraint = "【年级背景（仅供你内部参考，不要在反馈中提及年级）】{$knowledge}\n\n";
    $constraint .= "【知识范围约束】\n";
    $constraint .= "1. 给建议/推荐练习方向时，只能推荐该年级及之前已学的知识点和方法。\n";
    $constraint .= "2. 如果授课内容（上面已列出）已经涉及了后续年级的知识（如初三复习初一内容），这属于正常教学安排，你只需基于该授课内容生成反馈，不要评价\"这是超纲内容\"。\n";
    $constraint .= "3. 不要在反馈中写\"这个年级应该...\"\"到了X年级就...\"之类的年级对比表述。\n";
    $constraint .= "4. 举例子、推荐方法时，用该年级已掌握的工具。例如给初一学生推荐解题方法时用方程而不是函数。";

    return $constraint;
}

/**
 * 获取语言风格规范（公共部分，消除 buildPrompt 和 buildBatchPrompt 中的重复）
 * @return string 语言风格规范文本
 */
function getStyleGuidelines() {
    return <<<STYLE
【语言风格规范】
- 称呼：统一使用"孩子"
- 表扬：具体描述好在哪里（如"计算步骤很规范"而非"表现好"）
- 指出不足：用"需要加强""建议多练习""还需巩固"等建设性表达，不用"很差""不行""太差""糟糕"等负面定性词
- 给建议：只在描述课堂表现时提及需要加强的方面，不要给出课后练习建议或训练方案（如"建议课后做XX练习""每天做X道题"等）。课后作业由老师在"作业"部分统一布置
- 整体语气：像老师课后和家长的正常交流，客观平和
- 禁止使用的语气词/表达："哈""哦""呢""吧"等刻意亲切的语气词、"～"波浪号、"真是让人高兴呢""不过呢""真不错呢"等卖萌表达
- 禁止使用的结尾："辛苦啦""一起加油""继续努力""相信你可以的""期待你的进步"等模板化客套话
- 禁止使用的生硬称呼："该生""该同学""学员""该学员"
STYLE;
}

/**
 * 获取辅导机构专业立场规范（公共部分）
 * @return string
 */
function getProfessionalGuidelines() {
    return <<<GUIDE
【辅导机构的专业立场】
- 不与其他机构或老师做对比
- 不承诺具体提分效果
- 不给家长施加焦虑
- 对薄弱生保持积极期待，传递"通过持续努力可以提升"的信号
- 让家长感受到机构对孩子个体成长的关注
GUIDE;
}

// 安全常量
define('PASSWORD_BCRYPT_COST', 12);
define('SESSION_LIFETIME', 86400 * 7); // 7天

// 错误日志目录
define('LOG_DIR', __DIR__ . '/data/logs');

/**
 * 写入错误日志
 */
function logError($message, $context = []) {
    $dir = LOG_DIR;
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    $logFile = $dir . '/error_' . date('Y-m-d') . '.log';
    $timestamp = date('Y-m-d H:i:s');
    $contextStr = !empty($context) ? ' ' . json_encode($context, JSON_UNESCAPED_UNICODE) : '';
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $line = "[{$timestamp}] [IP:{$ip}] {$message}{$contextStr}\n";
    @file_put_contents($logFile, $line, FILE_APPEND | LOCK_EX);
}

/**
 * 写入操作日志
 */
function logAction($action, $detail = '') {
    $dir = LOG_DIR;
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    $logFile = $dir . '/action_' . date('Y-m-d') . '.log';
    $timestamp = date('Y-m-d H:i:s');
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $line = "[{$timestamp}] [IP:{$ip}] [{$action}] {$detail}\n";
    @file_put_contents($logFile, $line, FILE_APPEND | LOCK_EX);
}

// 启动session
if (session_status() === PHP_SESSION_NONE) {
    // 关闭可能的输出缓冲，避免session_start产生headers_sent警告
    if (headers_sent($file, $line)) {
        // headers已发送，跳过session启动
        // 但这种情况在API请求中不应发生，记录日志
        error_log("[API] headers already sent at {$file}:{$line}, skipping session_start");
    } else {
        @session_set_cookie_params([
            'lifetime' => SESSION_LIFETIME,
            'path' => '/',
            'domain' => '',
            'secure' => isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on',
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        @session_start();
    }
}

// ============ 身份验证辅助函数 ============
// 注意：当前系统使用前端验证码（verifyAccess）进行访问控制，
// 以下用户认证系统（session/login）为未来多用户版本预留，暂未集成到 API 流程中。

/**
 * 检查当前用户是否已登录
 */
function isLoggedIn() {
    return isset($_SESSION['user_id']) && $_SESSION['user_id'] > 0;
}

/**
 * 获取当前登录用户ID
 */
function getCurrentUserId() {
    return $_SESSION['user_id'] ?? 0;
}

/**
 * 获取当前登录用户角色
 */
function getCurrentUserRole() {
    return $_SESSION['user_role'] ?? '';
}

/**
 * 检查当前用户是否为管理员
 */
function isAdmin() {
    return ($_SESSION['user_role'] ?? '') === 'admin';
}

/**
 * 要求登录，否则返回401
 */
function requireLogin() {
    if (!isLoggedIn()) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => '请先登录', 'code' => 'AUTH_REQUIRED'], JSON_UNESCAPED_UNICODE);
        exit;
    }
}

/**
 * 要求管理员权限
 */
function requireAdmin() {
    requireLogin();
    if (!isAdmin()) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => '需要管理员权限', 'code' => 'ADMIN_REQUIRED'], JSON_UNESCAPED_UNICODE);
        exit;
    }
}

/**
 * 获取系统配置
 */
function getSystemConfig($key, $default = '') {
    $db = getDB();
    $stmt = $db->prepare("SELECT config_value FROM system_config WHERE config_key = :key");
    $stmt->bindValue(':key', $key, SQLITE3_TEXT);
    $result = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
    return $result ? $result['config_value'] : $default;
}
