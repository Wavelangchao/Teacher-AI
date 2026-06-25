<?php
/**
 * 数据库初始化
 */

require_once __DIR__ . '/config.php';

function initDatabase() {
    $dir = dirname(DB_PATH);
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }

    $db = new SQLite3(DB_PATH);

    // ============ 用户系统表 ============
    
    // 用户表
    $db->exec("CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        email TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        role TEXT NOT NULL DEFAULT 'teacher',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME,
        updated_at DATETIME
    )");

    // 邮箱验证码表
    $db->exec("CREATE TABLE IF NOT EXISTS email_verify_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        code TEXT NOT NULL,
        purpose TEXT NOT NULL DEFAULT 'register',
        used INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER NOT NULL,
        created_at DATETIME
    )");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_email_codes_email_purpose ON email_verify_codes (email, purpose, expires_at)");

    // 短信验证码表
    $db->exec("CREATE TABLE IF NOT EXISTS sms_verify_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT NOT NULL,
        code TEXT NOT NULL,
        purpose TEXT NOT NULL DEFAULT 'register',
        used INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER NOT NULL,
        created_at DATETIME
    )");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_sms_codes_phone_purpose ON sms_verify_codes (phone, purpose, expires_at)");

    // 登录失败记录表（防爆破）
    $db->exec("CREATE TABLE IF NOT EXISTS login_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        ip TEXT NOT NULL,
        success INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME
    )");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_time ON login_attempts (ip, created_at)");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_login_attempts_username_time ON login_attempts (username, created_at)");

    // 登录锁定时长表
    $db->exec("CREATE TABLE IF NOT EXISTS login_locks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT,
        ip TEXT,
        locked_until INTEGER NOT NULL,
        created_at DATETIME
    )");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_login_locks ON login_locks (username, ip, locked_until)");

    // 密码重置token表
    $db->exec("CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token TEXT NOT NULL UNIQUE,
        used INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER NOT NULL,
        created_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_reset_tokens ON password_reset_tokens (token, expires_at)");

    // 用户API配置表（每个用户独立的千问Key）
    $db->exec("CREATE TABLE IF NOT EXISTS user_api_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        api_key TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT 'qwen-plus',
        temperature REAL NOT NULL DEFAULT 0.7,
        max_tokens INTEGER NOT NULL DEFAULT 2000,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME,
        updated_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_user_api_config ON user_api_config (user_id, is_active)");

    // 系统配置表（管理员配置：短信/邮箱接口等）
    $db->exec("CREATE TABLE IF NOT EXISTS system_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        config_key TEXT NOT NULL UNIQUE,
        config_value TEXT,
        config_type TEXT DEFAULT 'text',
        description TEXT DEFAULT '',
        created_at DATETIME,
        updated_at DATETIME
    )");

    // 验证码图片表（图形验证码，防机器注册）
    $db->exec("CREATE TABLE IF NOT EXISTS captcha_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        code TEXT NOT NULL,
        used INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER NOT NULL,
        created_at DATETIME
    )");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_captcha_session ON captcha_codes (session_id, expires_at)");

    // ============ 兼容旧表 ============
    
    // API配置表（兼容旧版全局Key）
    $db->exec("CREATE TABLE IF NOT EXISTS api_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        api_key TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT 'qwen-plus',
        temperature REAL NOT NULL DEFAULT 0.7,
        max_tokens INTEGER NOT NULL DEFAULT 2000,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME,
        updated_at DATETIME
    )");

    // 反馈记录表（增加user_id和student_level字段）
    $db->exec("CREATE TABLE IF NOT EXISTS feedback_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER DEFAULT 0,
        student_name TEXT DEFAULT '',
        student_level TEXT DEFAULT '',
        homework_status TEXT,
        attention_status TEXT,
        drowsy_status TEXT DEFAULT '',
        daydream_status TEXT DEFAULT '',
        exercise_status TEXT,
        basic_knowledge TEXT,
        formula_mastery TEXT DEFAULT '',
        skill_speed TEXT,
        analysis_ability TEXT,
        calculation_ability TEXT,
        teaching_content TEXT,
        homework_assign TEXT DEFAULT '',
        custom_note TEXT DEFAULT '',
        generated_feedback TEXT,
        model_used TEXT,
        prompt_tokens INTEGER DEFAULT 0,
        completion_tokens INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        created_at DATETIME
    )");

    // 兼容旧表：尝试添加新字段（如果表已存在但缺少字段）
    try { @$db->exec("ALTER TABLE feedback_history ADD COLUMN user_id INTEGER DEFAULT 0"); } catch (\Throwable) {}
    try { @$db->exec("ALTER TABLE feedback_history ADD COLUMN student_level TEXT DEFAULT ''"); } catch (\Throwable) {}
    try { @$db->exec("ALTER TABLE feedback_history ADD COLUMN student_name TEXT DEFAULT ''"); } catch (\Throwable) {}
    try { @$db->exec("ALTER TABLE feedback_history ADD COLUMN homework_assign TEXT DEFAULT ''"); } catch (\Throwable) {}
    try { @$db->exec("ALTER TABLE feedback_history ADD COLUMN custom_note TEXT DEFAULT ''"); } catch (\Throwable) {}
    try { @$db->exec("ALTER TABLE feedback_history ADD COLUMN drowsy_status TEXT DEFAULT ''"); } catch (\Throwable) {}
    try { @$db->exec("ALTER TABLE feedback_history ADD COLUMN daydream_status TEXT DEFAULT ''"); } catch (\Throwable) {}
    try { @$db->exec("ALTER TABLE feedback_history ADD COLUMN prompt_tokens INTEGER DEFAULT 0"); } catch (\Throwable) {}
    try { @$db->exec("ALTER TABLE feedback_history ADD COLUMN completion_tokens INTEGER DEFAULT 0"); } catch (\Throwable) {}
    try { @$db->exec("ALTER TABLE feedback_history ADD COLUMN total_tokens INTEGER DEFAULT 0"); } catch (\Throwable) {}
    try { @$db->exec("ALTER TABLE feedback_history ADD COLUMN study_habit TEXT DEFAULT ''"); } catch (\Throwable) {}
    try { @$db->exec("ALTER TABLE feedback_history ADD COLUMN progress_trend TEXT DEFAULT ''"); } catch (\Throwable) {}
    try { @$db->exec("ALTER TABLE feedback_history ADD COLUMN interaction_status TEXT DEFAULT ''"); } catch (\Throwable) {}
    try { @$db->exec("ALTER TABLE feedback_history ADD COLUMN math_thinking TEXT DEFAULT ''"); } catch (\Throwable) {}
    try { @$db->exec("ALTER TABLE feedback_history ADD COLUMN teaching_scene TEXT DEFAULT ''"); } catch (\Throwable) {}
    try { @$db->exec("ALTER TABLE feedback_history ADD COLUMN student_grade TEXT DEFAULT ''"); } catch (\Throwable) {}
    try { @$db->exec("ALTER TABLE feedback_history ADD COLUMN formula_mastery TEXT DEFAULT ''"); } catch (\Throwable) {}

    // 频率限制表
    $db->exec("CREATE TABLE IF NOT EXISTS rate_limits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip TEXT NOT NULL,
        action TEXT NOT NULL,
        timestamp INTEGER NOT NULL
    )");
    $db->exec("CREATE INDEX IF NOT EXISTS idx_rate_limits_ip_time ON rate_limits (ip, timestamp)");

    // ============ 创建默认管理员（首次部署时生成随机密码） ============
    $exists = $db->querySingle("SELECT COUNT(*) FROM users WHERE role = 'admin'");
    if ($exists == 0) {
        $now = date('Y-m-d H:i:s');
        // 生成随机安全密码（首次启动时打印到日志，管理员需登录后立即修改）
        $randomPass = bin2hex(random_bytes(8)); // 16位随机十六进制
        $defaultPass = password_hash($randomPass, PASSWORD_BCRYPT);
        $stmt = $db->prepare("INSERT INTO users (username, password_hash, email, role, is_active, created_at, updated_at) VALUES (:u, :p, :e, 'admin', 1, :n, :n)");
        $stmt->bindValue(':u', 'admin', SQLITE3_TEXT);
        $stmt->bindValue(':p', $defaultPass, SQLITE3_TEXT);
        $stmt->bindValue(':e', 'admin@example.com', SQLITE3_TEXT);
        $stmt->bindValue(':n', $now, SQLITE3_TEXT);
        $stmt->execute();
        // 记录初始密码到日志（部署者需查看日志获取）
        error_log('[teacher] 默认管理员账号创建成功，初始密码: ' . $randomPass . '，请登录后立即修改密码');
    }

    // ============ 初始化系统配置默认值 ============
    $defaultConfigs = [
        'email_host' => ['', 'SMTP服务器地址'],
        'email_port' => ['587', 'SMTP端口'],
        'email_user' => ['', 'SMTP用户名'],
        'email_pass' => ['', 'SMTP密码（加密存储）'],
        'email_from' => ['', '发件人地址'],
        'email_from_name' => ['数学辅导', '发件人名称'],
        'sms_access_key' => ['', '阿里云短信AccessKey ID'],
        'sms_access_secret' => ['', '阿里云短信AccessKey Secret（加密存储）'],
        'sms_sign_name' => ['', '短信签名'],
        'sms_template_register' => ['', '注册验证码模板CODE'],
        'sms_template_reset' => ['', '重置密码模板CODE'],
        'login_max_attempts' => ['5', '登录最大尝试次数'],
        'login_lock_minutes' => ['15', '登录锁定分钟数'],
    ];
    $insertStmt = $db->prepare("INSERT OR IGNORE INTO system_config (config_key, config_value, description, created_at, updated_at) VALUES (:k, :v, :d, :n, :n)");
    foreach ($defaultConfigs as $key => $val) {
        $insertStmt->bindValue(':k', $key, SQLITE3_TEXT);
        $insertStmt->bindValue(':v', $val[0], SQLITE3_TEXT);
        $insertStmt->bindValue(':d', $val[1], SQLITE3_TEXT);
        $insertStmt->bindValue(':n', date('Y-m-d H:i:s'), SQLITE3_TEXT);
        $insertStmt->execute();
        $insertStmt->reset();
    }

    return $db;
}

function getDB() {
    static $db = null;
    if ($db === null) {
        // 确保目录存在
        $dir = dirname(DB_PATH);
        if (!is_dir($dir)) {
            if (!@mkdir($dir, 0755, true)) {
                throw new \RuntimeException("无法创建数据目录: {$dir}，请检查上级目录的写入权限。");
            }
            // 创建 .htaccess 防止直接访问
            @file_put_contents($dir . '/.htaccess', "Deny from all\n");
        }
        if (!is_writable($dir)) {
            throw new \RuntimeException("数据目录不可写: {$dir}，请检查权限设置。");
        }
        
        $db = new SQLite3(DB_PATH);
        $db->busyTimeout(5000);
        $db->exec("PRAGMA journal_mode=WAL");
        $db->exec("PRAGMA foreign_keys=ON");
        $db->exec("PRAGMA synchronous=NORMAL");
        
        // 确保数据库表已初始化（防止文件加载时的initDatabase失败导致表缺失）
        try {
            initDatabase();
        } catch (\Throwable $e) {
            // 数据库已打开但表可能已存在，忽略初始化错误
            // 如果关键表缺失，后续操作会报错并返回清晰的JSON错误
        }
    }
    return $db;
}

// 初始化数据库（文件加载时执行）
try {
    initDatabase();
} catch (\Throwable $e) {
    // 静默失败，getDB() 会在实际使用时初始化
    // 记录错误日志但不中断
    if (function_exists('logError')) {
        logError('数据库初始化失败: ' . $e->getMessage());
    } else {
        error_log('[teacher] 数据库初始化失败: ' . $e->getMessage());
    }
}
