<?php
/**
 * 教师课后反馈系统 - API接口
 * 支持：千问AI调用、配置管理、流式SSE生成、历史记录
 */

// ============================================================
//  错误处理：确保所有错误都以JSON格式返回
// ============================================================
// 关闭所有错误显示，只记录到日志
error_reporting(E_ALL);
ini_set('display_errors', 0);
ini_set('display_startup_errors', 0);
ini_set('log_errors', 1);
// 确保不会因PHP配置而输出HTML错误
ini_set('html_errors', 0);

// 对于SSE流式接口不启用缓冲（流式需要实时输出）
$action = $_GET['action'] ?? $_POST['action'] ?? '';
if ($action !== 'stream_feedback' && $action !== 'stream_feedback_batch') {
    ob_start();
}

// 注册shutdown函数作为最后的兜底：捕获fatal error并输出JSON
register_shutdown_function(function() {
    $error = error_get_last();
    if ($error && ($error['type'] & (E_ERROR | E_PARSE | E_CORE_ERROR | E_COMPILE_ERROR | E_USER_ERROR))) {
        // 清除之前的所有输出缓冲
        while (ob_get_level() > 0) {
            ob_end_clean();
        }
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode([
            'success' => false,
            'message' => '服务器内部错误，请稍后重试',
            'error_id' => uniqid('err_'),
        ], JSON_UNESCAPED_UNICODE);
    }
});

// 设置异常处理器，确保所有未捕获异常返回JSON
set_exception_handler(function($e) {
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    if (function_exists('logError')) {
        logError('未捕获异常: ' . $e->getMessage(), [
            'file' => basename($e->getFile()),
            'line' => $e->getLine(),
            'trace' => $e->getTraceAsString(),
        ]);
    }
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'success' => false,
        'message' => '服务器内部错误，请稍后重试',
        'error_id' => uniqid('err_'),
    ], JSON_UNESCAPED_UNICODE);
    exit;
});

// 设置错误处理器，将所有PHP错误转为异常
set_error_handler(function($severity, $message, $file, $line) {
    if (!(error_reporting() & $severity)) return false;
    if ($severity === E_DEPRECATED || $severity === E_USER_DEPRECATED) {
        return true;
    }
    throw new \ErrorException($message, 0, $severity, $file, $line);
});

// 加载配置文件（在最外层兜底）
try {
    require_once __DIR__ . '/config.php';
    require_once __DIR__ . '/database.php';
} catch (\Throwable $e) {
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'success' => false,
        'message' => '系统初始化失败，请检查data/目录权限和PHP扩展',
        'error_id' => uniqid('err_'),
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// 请求频率限制（防止滥用）
function checkRateLimit($action) {
    // 只对写操作和消耗资源的操作做频率限制
    $rateLimitedActions = ['stream_feedback', 'stream_feedback_batch', 'generate_feedback', 'save_config', 'delete_config', 'delete_history', 'delete_history_batch'];
    if (!in_array($action, $rateLimitedActions)) return true;

    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $db = getDB();
    $window = 60; // 60秒窗口
    $now = time();
    $cutoff = $now - $window;

    // 定期清理过期记录（概率性执行，减少频繁清理）
    if (mt_rand(1, 10) === 1) {
        try {
            $db->exec("DELETE FROM rate_limits WHERE timestamp < {$cutoff}");
        } catch (\Exception $e) {}
    }

    // 统计当前窗口内请求数
    $stmt = $db->prepare("SELECT COUNT(*) FROM rate_limits WHERE ip = :ip AND action = :action AND timestamp >= :cutoff");
    $stmt->bindValue(':ip', $ip, SQLITE3_TEXT);
    $stmt->bindValue(':action', $action, SQLITE3_TEXT);
    $stmt->bindValue(':cutoff', $cutoff, SQLITE3_INTEGER);
    $count = $stmt->execute()->fetchArray(SQLITE3_NUM)[0] ?? 0;
    
    $limits = [
        'stream_feedback' => 10,
        'stream_feedback_batch' => 5,
        'generate_feedback' => 10,
        'save_config' => 5,
        'delete_config' => 3,
        'delete_history' => 20,
        'delete_history_batch' => 10,
    ];

    $maxRequests = $limits[$action] ?? 20;

    if ($count >= $maxRequests) {
        logError("频率限制触发", ['ip' => $ip, 'action' => $action, 'count' => $count]);
        http_response_code(429);
        echo json_encode(['success' => false, 'message' => '请求过于频繁，请稍后再试（' . $window . '秒内最多' . $maxRequests . '次）'], JSON_UNESCAPED_UNICODE);
        return false;
    }

    // 记录本次请求
    $stmt = $db->prepare("INSERT INTO rate_limits (ip, action, timestamp) VALUES (:ip, :action, :now)");
    $stmt->bindValue(':ip', $ip, SQLITE3_TEXT);
    $stmt->bindValue(':action', $action, SQLITE3_TEXT);
    $stmt->bindValue(':now', $now, SQLITE3_INTEGER);
    $stmt->execute();
    return true;
}

$action = $_GET['action'] ?? $_POST['action'] ?? '';

// Access Token 校验已移除（验证码改为前端校验）

// SSE流式接口不需要JSON header，其他情况尽早设置JSON Content-Type
if ($action !== 'stream_feedback') {
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('X-XSS-Protection: 1; mode=block');
    header('Referrer-Policy: strict-origin-when-cross-origin');
    header('X-Permitted-Cross-Domain-Policies: none');
    // 禁用缓存，确保每次请求获取最新数据
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Pragma: no-cache');
    header('Expires: Thu, 01 Jan 1970 00:00:00 GMT');
    // CORS headers（严格同源策略，仅允许当前域名）
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $serverHost = $_SERVER['HTTP_HOST'] ?? '';
    // 仅当Origin与当前服务器域名精确匹配时允许
    $allowedOrigin = '';
    if (!empty($origin) && !empty($serverHost)) {
        $originHost = parse_url($origin, PHP_URL_HOST);
        if ($originHost && ($originHost === $serverHost || $originHost === ('www.' . $serverHost) || ('www.' . $originHost) === $serverHost)) {
            $allowedOrigin = $origin;
        }
    }
    // 同源请求（无Origin头）不需要设置ACAO
    if ($allowedOrigin) {
        header('Access-Control-Allow-Origin: ' . $allowedOrigin);
        header('Access-Control-Allow-Credentials: true');
    }
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
}

// 频率限制检查（必须在 header 设置之后，因为频率限制可能输出 JSON 错误）
if (!checkRateLimit($action)) {
    exit;
}
// 处理 OPTIONS 预检请求
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// CSRF检查（对写操作验证Origin/Referer）
$isWriteAction = in_array($action, ['save_config', 'delete_config', 'delete_history', 'delete_history_batch', 'stream_feedback', 'stream_feedback_batch', 'generate_feedback']);
if ($isWriteAction && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $referer = $_SERVER['HTTP_REFERER'] ?? '';
    $serverHost = $_SERVER['HTTP_HOST'] ?? '';
    $isValidOrigin = false;
    
    if (!empty($origin)) {
        $originHost = parse_url($origin, PHP_URL_HOST);
        $isValidOrigin = $originHost && ($originHost === $serverHost);
    } elseif (!empty($referer)) {
        $refererHost = parse_url($referer, PHP_URL_HOST);
        $isValidOrigin = $refererHost && ($refererHost === $serverHost);
    } else {
        // 同源请求可能没有Origin/Referer头（直接输入URL访问），允许通过
        $isValidOrigin = true;
    }
    
    if (!$isValidOrigin) {
        logError("CSRF校验失败", ['action' => $action, 'origin' => $origin, 'referer' => $referer, 'host' => $serverHost]);
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => '请求来源校验失败，请刷新页面后重试'], JSON_UNESCAPED_UNICODE);
        exit;
    }
}

switch ($action) {
    case 'save_config':     saveApiConfig(); break;
    case 'get_config':      getApiConfig(); break;
    case 'delete_config':   deleteApiConfig(); break;
    case 'generate_feedback': generateFeedback(); break;
    case 'stream_feedback': streamFeedback(); break;
    case 'stream_feedback_batch': streamFeedbackBatch(); break;
    case 'get_history':     getHistory(); break;
    case 'delete_history':       deleteHistory(); break;
    case 'delete_history_batch': deleteHistoryBatch(); break;
    case 'student_profile':  getStudentProfile(); break;
    case 'verify_access':   verifyAccess(); break;
    case 'diagnose':        diagnose(); break;
    case 'verify_key':      verifyApiKey(); break;
    case 'token_stats':     getTokenStats(); break;
    case 'quota_info':      getQuotaInfo(); break;
    case 'test_model':      testModel(); break;
    case 'test_all_models': testAllModels(); break;
    case 'export_data':     exportData(); break;
    default:
        echo json_encode(['success' => false, 'message' => '未知操作'], JSON_UNESCAPED_UNICODE);
}

// 正常执行结束：flush输出缓冲（清除非SSE请求的缓冲）
if ($action !== 'stream_feedback' && $action !== 'stream_feedback_batch' && ob_get_level() > 0) {
    ob_end_flush();
}

// ============================================================
//  安全工具函数：统一输出安全的JSON（防止JSON劫持）
// ============================================================
function jsonResponse($data, $httpCode = 200) {
    if ($httpCode !== 200) {
        http_response_code($httpCode);
    }
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
}

/**
 * 安全的JSON响应（带成功/失败标识）
 */
function apiResponse($success, $message = '', $extra = []) {
    $data = array_merge(['success' => $success, 'message' => $message], $extra);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
}

// ============================================================
//  流式生成反馈 (SSE)
// ============================================================
function streamFeedback() {
    @ini_set('output_buffering', 'off');
    @ini_set('zlib.output_compression', false);
    while (ob_get_level()) { ob_end_clean(); }

    header('Content-Type: text/event-stream; charset=utf-8');
    header('Cache-Control: no-cache');
    header('Connection: keep-alive');
    header('X-Accel-Buffering: no');

    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    
    // 输入长度校验（安全防护）
    $maxFieldLength = 5000;
    $textFields = ['student_name', 'teaching_content', 'homework_assign', 'custom_note'];
    foreach ($textFields as $field) {
        if (isset($input[$field]) && mb_strlen($input[$field]) > $maxFieldLength) {
            sendSSE('error', "{$field} 输入过长，请限制在{$maxFieldLength}字以内");
            sendSSE('done', ''); return;
        }
    }

    // 学生姓名长度限制（防止异常数据）
    if (isset($input['student_name']) && mb_strlen($input['student_name']) > 100) {
        sendSSE('error', '学生姓名过长，请限制在100字以内');
        sendSSE('done', ''); return;
    }

    // 水平等级白名单校验
    $validLevels = ['优秀', '良好', '中等', '薄弱'];
    if (isset($input['student_level']) && $input['student_level'] !== '' && !in_array($input['student_level'], $validLevels, true)) {
        sendSSE('error', '无效的学生水平等级');
        sendSSE('done', ''); return;
    }

    // 年级白名单校验
    $validGrades = ['小一', '小二', '小三', '小四', '小五', '小六', '初一', '初二', '初三', '高一', '高二', '高三'];
    if (isset($input['student_grade']) && $input['student_grade'] !== '' && !in_array($input['student_grade'], $validGrades, true)) {
        sendSSE('error', '无效的学生年级');
        sendSSE('done', ''); return;
    }

    // 教学场景白名单校验
    $validScenes = ['', 'one_on_one', 'small_group', 'large_group', 'online', 'exam_review', 'holiday_camp'];
    if (isset($input['teaching_scene']) && !in_array($input['teaching_scene'], $validScenes, true)) {
        sendSSE('error', '无效的教学场景');
        sendSSE('done', ''); return;
    }

    // 字数范围校验
    $validWordRanges = ['150-250', '200-400', '350-550', '500-800'];
    if (isset($input['word_count_range']) && !in_array($input['word_count_range'], $validWordRanges, true)) {
        $input['word_count_range'] = '200-400'; // 非法值用默认值
    }

    // 反馈日期格式校验（只接受 "M.D" 格式，如 "6.8"）
    if (isset($input['feedback_date']) && $input['feedback_date'] !== '') {
        if (!preg_match('/^\d{1,2}\.\d{1,2}$/', $input['feedback_date'])) {
            $input['feedback_date'] = date('n.j'); // 格式不正确用当天日期
        }
    }

    // ============ 数据清洗：去除重复/矛盾的评价维度 ============
    $input = cleanInputData($input);

    $db = getDB();
    $config = $db->querySingle("SELECT * FROM api_config WHERE is_active = 1 ORDER BY id DESC LIMIT 1", true);

    if (!$config) {
        sendSSE('error', '请先配置千问API参数');
        sendSSE('done', ''); return;
    }

    $apiKey = decryptData($config['api_key']);
    if (empty($apiKey)) {
        sendSSE('error', 'API Key解密失败，请重新配置');
        sendSSE('done', ''); return;
    }

    $prompt = buildPrompt($input);
    
    // 根据字数范围动态计算 max_tokens（1中文汉字≈1.5~2 tokens，取上限确保足够）
    $wordCountRange = $input['word_count_range'] ?? '200-400';
    $rangeParts = explode('-', $wordCountRange);
    $wordMax = intval($rangeParts[1] ?? 400);
    $dynamicMaxTokens = max(intval($config['max_tokens']), $wordMax * 3); // 确保至少是配置值
    $dynamicMaxTokens = min($dynamicMaxTokens, 6000); // 上限6000
    
    $body = json_encode([
        'model'           => $config['model'],
        'messages'        => $prompt,
        'temperature'     => floatval($config['temperature']),
        'max_tokens'      => $dynamicMaxTokens,
        'stream'          => true,
        'stream_options'  => ['include_usage' => true],
    ], JSON_UNESCAPED_UNICODE);

    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL            => QWEN_API_URL,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $body,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json; charset=utf-8',
            'Authorization: Bearer ' . $apiKey,
            'Accept: text/event-stream',
        ],
        CURLOPT_RETURNTRANSFER => false,
        CURLOPT_TIMEOUT        => 120,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTP_VERSION   => CURL_HTTP_VERSION_1_1,
        CURLOPT_IPRESOLVE      => CURL_IPRESOLVE_V4,
        CURLOPT_ENCODING       => '',
        CURLOPT_FOLLOWLOCATION => false,  // SSE流式请求不应被重定向
    ]);

    // 流式回调：逐行处理千问返回的SSE数据
    $fullContent = '';
    $streamUsage = null;  // 保存usage信息
    $streamModel = $config['model'];  // 保存实际模型名
    curl_setopt($ch, CURLOPT_WRITEFUNCTION, function($ch, $data) use (&$fullContent, &$streamUsage, $input, $streamModel, $prompt) {
        $lines = explode("\n", $data);
        foreach ($lines as $line) {
            $line = trim($line);
            if (empty($line) || !str_starts_with($line, 'data:')) continue;

            $jsonStr = trim(substr($line, 5));
            if ($jsonStr === '[DONE]') {
                // 保存记录（含token数据）
                $usage = $streamUsage;
                // 兜底：如果API没有返回usage或返回的全是0，基于内容长度估算
                // 注意：千问流式API在某些版本中不返回usage，或返回全0的usage
                $totalTokens = $usage['total_tokens'] ?? 0;
                if (empty($usage) || $totalTokens <= 0) {
                    $promptLen = strlen(json_encode($prompt, JSON_UNESCAPED_UNICODE));
                    $contentLen = strlen($fullContent);
                    // 中英文混合估算：中文约1.5字符/token，英文/标点约4字符/token，取保守值约3字符/token
                    $estPrompt = max(1, intval($promptLen / 3));
                    $estCompletion = max(1, intval($contentLen / 3));
                    $usage = [
                        'prompt_tokens' => $estPrompt,
                        'completion_tokens' => $estCompletion,
                        'total_tokens' => $estPrompt + $estCompletion,
                        '_estimated' => true,
                    ];
                }
                if (!empty($fullContent)) saveStreamRecord($fullContent, $input, $usage, $streamModel);
                // 发送usage和模型信息给前端
                sendSSE('usage', array_merge($usage, ['model' => $streamModel]));
                sendSSE('done', '');
                continue;
            }

            $chunk = json_decode($jsonStr, true);
            if (!$chunk) continue;

            // 捕获usage信息（千问可能在最后一条消息的usage字段中返回）
            if (isset($chunk['usage']) && is_array($chunk['usage'])) {
                $streamUsage = $chunk['usage'];
                // 同时向前端发送实时token信息
                sendSSE('usage', array_merge($streamUsage, ['model' => $streamModel]));
            }

            $delta = $chunk['choices'][0]['delta']['content'] ?? '';
            if ($delta !== '') {
                $fullContent .= $delta;
                sendSSE('text', $delta);
            }
        }
        return strlen($data);
    });

    $success   = curl_exec($ch);
    $curlErrno = curl_errno($ch);
    $curlError = curl_error($ch);
    $httpCode  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($curlErrno) {
        logError('streamFeedback curl错误', [
            'errno' => $curlErrno,
            'error' => $curlError,
            'model' => $config['model'],
        ]);
        sendSSE('error', '网络请求失败：' . $curlError);
        sendSSE('done', '');
        return;
    }
    
    if ($httpCode !== 200) {
        logError('streamFeedback HTTP错误', [
            'http_code' => $httpCode,
            'model' => $config['model'],
            'content_len' => strlen($fullContent),
        ]);
        
        // 尝试解析API返回的错误详情
        $errorDetail = "HTTP状态码：{$httpCode}";
        
        // 检查是否已有部分内容（writefunction可能已收到错误响应）
        if (empty($fullContent)) {
            // 错误响应没有被writefunction捕获（非流式错误响应），提供更详细的诊断信息
            switch ($httpCode) {
                case 400:
                    $errorDetail .= ' — 请求参数错误。可能原因：模型名称不正确、消息格式有误、或参数超限。';
                    break;
                case 401:
                    $errorDetail .= ' — API Key无效或已过期。请检查Key是否正确，或前往阿里云百炼控制台重新生成。';
                    break;
                case 403:
                    $errorDetail .= ' — 访问被拒绝。可能原因：① API Key没有该模型的调用权限（需在百炼控制台开通对应模型）；② 账户欠费或未开通百炼服务；③ Key已禁用。';
                    break;
                case 404:
                    $errorDetail .= ' — API端点不存在。请检查API地址配置是否正确。';
                    break;
                case 429:
                    $errorDetail .= ' — 请求频率超限，请稍后重试。';
                    break;
                case 500:
                case 502:
                case 503:
                    $errorDetail .= ' — 千问服务器错误，请稍后重试。';
                    break;
                default:
                    $errorDetail .= ' — 未知错误。';
            }
            $errorDetail .= " 当前模型：{$config['model']}";
        } else {
            $errorDetail = 'API在生成过程中返回错误（已生成部分内容），HTTP状态码：' . $httpCode;
        }
        
        sendSSE('error', $errorDetail);
        sendSSE('done', '');
        return;
    }

    // 记录成功生成
    logAction('stream_feedback', "模型: {$config['model']}, 内容长度: " . strlen($fullContent) . ", 学生: " . ($input['student_name'] ?? '未知'));
    sendSSE('done', '');
}

// ============================================================
//  小班课批量生成反馈 (SSE) - 一次性为多名学生生成反馈
// ============================================================
function streamFeedbackBatch() {
    @ini_set('output_buffering', 'off');
    @ini_set('zlib.output_compression', false);
    while (ob_get_level()) { ob_end_clean(); }

    header('Content-Type: text/event-stream; charset=utf-8');
    header('Cache-Control: no-cache');
    header('Connection: keep-alive');
    header('X-Accel-Buffering: no');

    $input = json_decode(file_get_contents('php://input'), true) ?? [];

    // 校验学生列表
    $students = $input['students'] ?? [];
    if (empty($students) || !is_array($students)) {
        sendSSE('error', '请至少提供一位学生信息');
        sendSSE('done', ''); return;
    }
    if (count($students) > 10) {
        sendSSE('error', '单次最多支持10位学生，请分批生成');
        sendSSE('done', ''); return;
    }

    // 校验授课内容
    $teachingContent = $input['teaching_content'] ?? '';
    if (mb_strlen($teachingContent) > 5000) {
        sendSSE('error', '授课内容过长');
        sendSSE('done', ''); return;
    }

    // 字数范围校验
    $validWordRanges = ['150-250', '200-400', '350-550', '500-800'];
    $wordCountRange = $input['word_count_range'] ?? '200-400';
    if (!in_array($wordCountRange, $validWordRanges, true)) {
        $wordCountRange = '200-400';
    }

    // 反馈日期格式校验
    $feedbackDate = $input['feedback_date'] ?? date('n.j');
    if (!preg_match('/^\d{1,2}\.\d{1,2}$/', $feedbackDate)) {
        $feedbackDate = date('n.j');
    }

    // 年级白名单校验
    $validGrades = ['小一', '小二', '小三', '小四', '小五', '小六', '初一', '初二', '初三', '高一', '高二', '高三'];
    $studentGrade = $input['student_grade'] ?? '';
    if ($studentGrade !== '' && !in_array($studentGrade, $validGrades, true)) {
        $studentGrade = '';
    }

    $db = getDB();
    $config = $db->querySingle("SELECT * FROM api_config WHERE is_active = 1 ORDER BY id DESC LIMIT 1", true);

    if (!$config) {
        sendSSE('error', '请先配置千问API参数');
        sendSSE('done', ''); return;
    }

    $apiKey = decryptData($config['api_key']);
    if (empty($apiKey)) {
        sendSSE('error', 'API Key解密失败，请重新配置');
        sendSSE('done', ''); return;
    }

    // 解析字数范围
    $rangeParts = explode('-', $wordCountRange);
    $wordMin = intval($rangeParts[0] ?? 200);
    $wordMax = intval($rangeParts[1] ?? 400);
    $studentCount = count($students);
    // 动态 max_tokens：按目标字数×3倍（中文约1.5-2 tokens/字）+ 留buffer
    // 每学生至少 80字×3tokens = 240 tokens，外加系统提示和维度信息
    $perStudentTokens = max(240, intval($wordMax / $studentCount) * 3);
    $dynamicMaxTokens = max(intval($config['max_tokens']), $perStudentTokens * $studentCount + 600);
    $dynamicMaxTokens = min($dynamicMaxTokens, 8000);

    // 构建小班课Prompt
    $prompt = buildBatchPrompt($students, $teachingContent, $input, $feedbackDate, $wordMin, $wordMax, $studentGrade);

    $body = json_encode([
        'model'           => $config['model'],
        'messages'        => $prompt,
        'temperature'     => floatval($config['temperature']),
        'max_tokens'      => $dynamicMaxTokens,
        'stream'          => true,
        'stream_options'  => ['include_usage' => true],
    ], JSON_UNESCAPED_UNICODE);

    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL            => QWEN_API_URL,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $body,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json; charset=utf-8',
            'Authorization: Bearer ' . $apiKey,
            'Accept: text/event-stream',
        ],
        CURLOPT_RETURNTRANSFER => false,
        CURLOPT_TIMEOUT        => 300,
        CURLOPT_CONNECTTIMEOUT => 20,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTP_VERSION   => CURL_HTTP_VERSION_1_1,
        CURLOPT_IPRESOLVE      => CURL_IPRESOLVE_V4,
        CURLOPT_ENCODING       => '',
        CURLOPT_FOLLOWLOCATION => false,  // SSE流式请求不应被重定向
    ]);

    $fullContent = '';
    $streamUsage = null;
    $streamModel = $config['model'];
    curl_setopt($ch, CURLOPT_WRITEFUNCTION, function($ch, $data) use (&$fullContent, &$streamUsage, $input, $streamModel, $prompt, $students) {
        $lines = explode("\n", $data);
        foreach ($lines as $line) {
            $line = trim($line);
            if (empty($line) || !str_starts_with($line, 'data:')) continue;

            $jsonStr = trim(substr($line, 5));
            if ($jsonStr === '[DONE]') {
                $usage = $streamUsage;
                $totalTokens = $usage['total_tokens'] ?? 0;
                if (empty($usage) || $totalTokens <= 0) {
                    $promptLen = strlen(json_encode($prompt, JSON_UNESCAPED_UNICODE));
                    $contentLen = strlen($fullContent);
                    $estPrompt = max(1, intval($promptLen / 3));
                    $estCompletion = max(1, intval($contentLen / 3));
                    $usage = [
                        'prompt_tokens' => $estPrompt,
                        'completion_tokens' => $estCompletion,
                        'total_tokens' => $estPrompt + $estCompletion,
                        '_estimated' => true,
                    ];
                }
                // 为每位学生保存历史记录
                if (!empty($fullContent)) {
                    saveBatchRecords($fullContent, $students, $input, $usage, $streamModel);
                }
                sendSSE('usage', array_merge($usage, ['model' => $streamModel]));
                sendSSE('done', '');
                continue;
            }

            $chunk = json_decode($jsonStr, true);
            if (!$chunk) continue;

            if (isset($chunk['usage']) && is_array($chunk['usage'])) {
                $streamUsage = $chunk['usage'];
                sendSSE('usage', array_merge($streamUsage, ['model' => $streamModel]));
            }

            $delta = $chunk['choices'][0]['delta']['content'] ?? '';
            if ($delta !== '') {
                $fullContent .= $delta;
                sendSSE('text', $delta);
            }
        }
        return strlen($data);
    });

    $success   = curl_exec($ch);
    $curlErrno = curl_errno($ch);
    $curlError = curl_error($ch);
    $httpCode  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($curlErrno) {
        logError('streamFeedbackBatch curl错误', [
            'errno' => $curlErrno,
            'error' => $curlError,
            'model' => $config['model'],
        ]);
        sendSSE('error', '网络请求失败：' . $curlError);
        sendSSE('done', '');
        return;
    }

    if ($httpCode !== 200) {
        $errorDetail = "HTTP状态码：{$httpCode}";
        if (empty($fullContent)) {
            switch ($httpCode) {
                case 400: $errorDetail .= ' — 请求参数错误'; break;
                case 401: $errorDetail .= ' — API Key无效'; break;
                case 403: $errorDetail .= ' — 无访问权限'; break;
                case 429: $errorDetail .= ' — 请求频率超限，请稍后重试'; break;
                default: $errorDetail .= ' — 未知错误';
            }
            $errorDetail .= " 当前模型：{$config['model']}";
        }
        sendSSE('error', $errorDetail);
        sendSSE('done', '');
        return;
    }

    $sceneTypeLabel = ($input['teaching_scene'] ?? 'small_group') === 'large_group' ? '大班课' : '小班课';
    logAction('stream_feedback_batch', "模型: {$config['model']}, 场景: {$sceneTypeLabel}, 学生数: " . count($students) . ", 内容长度: " . strlen($fullContent));
    sendSSE('done', '');
}

function sendSSE($event, $data) {
    echo "event: {$event}\n";
    echo "data: " . json_encode($data, JSON_UNESCAPED_UNICODE) . "\n\n";
    if (ob_get_level()) { ob_flush(); }
    flush();
}

function saveStreamRecord($content, $inputData = array(), $usage = array(), $model = 'qwen-plus') {
    try {
        $db = getDB();
        $now = date('Y-m-d H:i:s');
        
        // 构建 SQL（使用统一常量避免字段遗漏）
        $dimensionMap = buildDimensionMap($inputData);
        $fields = array_keys(DIMENSION_KEYS);
        $columns = ['student_name', 'student_level', 'student_grade', 'teaching_content', 'teaching_scene', 'homework_assign', 'custom_note'];
        $columns = array_merge($columns, $fields);
        $columns = array_merge($columns, ['generated_feedback', 'model_used', 'prompt_tokens', 'completion_tokens', 'total_tokens', 'created_at']);
        
        $placeholders = array_map(fn($c) => ':' . $c, $columns);
        $sql = "INSERT INTO feedback_history (" . implode(', ', $columns) . ") VALUES (" . implode(', ', $placeholders) . ")";
        
        $stmt = $db->prepare($sql);
        $stmt->bindValue(':student_name', $inputData['student_name'] ?? '', SQLITE3_TEXT);
        $stmt->bindValue(':student_level', $inputData['student_level'] ?? '', SQLITE3_TEXT);
        $stmt->bindValue(':student_grade', $inputData['student_grade'] ?? '', SQLITE3_TEXT);
        $stmt->bindValue(':teaching_content', $inputData['teaching_content'] ?? '', SQLITE3_TEXT);
        $stmt->bindValue(':teaching_scene', $inputData['teaching_scene'] ?? '', SQLITE3_TEXT);
        $stmt->bindValue(':homework_assign', $inputData['homework_assign'] ?? '', SQLITE3_TEXT);
        $stmt->bindValue(':custom_note', $inputData['custom_note'] ?? '', SQLITE3_TEXT);
        
        foreach ($fields as $key) {
            $stmt->bindValue(':' . $key, $inputData[$key] ?? '', SQLITE3_TEXT);
        }
        
        $stmt->bindValue(':generated_feedback', $content, SQLITE3_TEXT);
        $stmt->bindValue(':model_used', $model, SQLITE3_TEXT);
        $stmt->bindValue(':prompt_tokens', intval($usage['prompt_tokens'] ?? 0), SQLITE3_INTEGER);
        $stmt->bindValue(':completion_tokens', intval($usage['completion_tokens'] ?? 0), SQLITE3_INTEGER);
        $stmt->bindValue(':total_tokens', intval($usage['total_tokens'] ?? 0), SQLITE3_INTEGER);
        $stmt->bindValue(':created_at', $now, SQLITE3_TEXT);
        $stmt->execute();
    } catch (\Exception $e) {
        logError('saveStreamRecord 失败: ' . $e->getMessage(), ['student' => ($inputData['student_name'] ?? '未知')]);
        // 向用户发送可见提示（SSE error 事件会被前端捕获显示）
        sendSSE('error', '反馈已生成但保存历史记录失败，请检查数据库权限：' . $e->getMessage());
    }
}

// ============================================================
//  配置管理
// ============================================================
function saveApiConfig() {
    try {
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $apiKey = trim($input['api_key'] ?? '');
        $model = trim($input['model'] ?? 'qwen-plus');
        $temperature = floatval($input['temperature'] ?? 0.7);
        $maxTokens = intval($input['max_tokens'] ?? 2000);

        // 输入长度安全校验
        if (mb_strlen($apiKey) > 200) {
            echo json_encode(['success' => false, 'message' => 'API Key过长'], JSON_UNESCAPED_UNICODE);
            return;
        }
        if (mb_strlen($model) > 100) {
            echo json_encode(['success' => false, 'message' => '模型名称过长'], JSON_UNESCAPED_UNICODE);
            return;
        }

        $db = getDB();

        // 检查是否用户想保留已有Key（输入为空或掩码格式）
        $isReuseKey = ($apiKey === '' || str_starts_with($apiKey, '••••••••') || str_starts_with($apiKey, '****'));
        
        if ($isReuseKey) {
            $existing = $db->querySingle("SELECT api_key FROM api_config WHERE is_active = 1 ORDER BY id DESC LIMIT 1", true);
            if ($existing && !empty($existing['api_key'])) {
                $decrypted = decryptData($existing['api_key']);
                if (!empty($decrypted)) {
                    $apiKey = $decrypted;
                } else {
                    echo json_encode([
                        'success' => false, 
                        'message' => '已有Key解密失败，请重新输入完整的API Key后保存',
                    ], JSON_UNESCAPED_UNICODE);
                    return;
                }
            } else {
                echo json_encode([
                    'success' => false, 
                    'message' => '未检测到已保存的API Key，请输入新的Key',
                ], JSON_UNESCAPED_UNICODE);
                return;
            }
        }

        // 校验新输入的Key格式
        if (!$isReuseKey && empty($apiKey)) {
            echo json_encode(['success' => false, 'message' => 'API Key不能为空'], JSON_UNESCAPED_UNICODE);
            return;
        }
        if (!$isReuseKey && !str_starts_with($apiKey, 'sk-')) {
            echo json_encode(['success' => false, 'message' => 'API Key格式不正确，千问Key应以 sk- 开头'], JSON_UNESCAPED_UNICODE);
            return;
        }
        if ($temperature < 0 || $temperature > 2) {
            echo json_encode(['success' => false, 'message' => 'Temperature范围应在0-2之间'], JSON_UNESCAPED_UNICODE);
            return;
        }
        if ($maxTokens < 50 || $maxTokens > 6000) {
            echo json_encode(['success' => false, 'message' => '最大Token数应在50-6000之间'], JSON_UNESCAPED_UNICODE);
            return;
        }

        // 先加密Key再保存
        $encryptedKey = encryptData($apiKey);
        if (empty($encryptedKey)) {
            echo json_encode(['success' => false, 'message' => 'Key加密失败，请联系管理员'], JSON_UNESCAPED_UNICODE);
            return;
        }

        // 关闭之前的活跃配置
        $db->exec("UPDATE api_config SET is_active = 0");

        $now = date('Y-m-d H:i:s');
        $stmt = $db->prepare("INSERT INTO api_config (api_key, model, temperature, max_tokens, is_active, created_at, updated_at) VALUES (:key, :model, :temp, :tokens, 1, :now, :now)");
        $stmt->bindValue(':key', $encryptedKey, SQLITE3_TEXT);
        $stmt->bindValue(':model', $model, SQLITE3_TEXT);
        $stmt->bindValue(':temp', $temperature, SQLITE3_FLOAT);
        $stmt->bindValue(':tokens', $maxTokens, SQLITE3_INTEGER);
        $stmt->bindValue(':now', $now, SQLITE3_TEXT);
        $stmt->execute();
        
        logAction('save_config', "模型切换为: {$model}, temp: {$temperature}, max_tokens: {$maxTokens}");
        echo json_encode(['success' => true, 'message' => '配置保存成功！模型：' . $model], JSON_UNESCAPED_UNICODE);
    } catch (\Throwable $e) {
        logError('saveApiConfig异常', ['error' => $e->getMessage(), 'file' => basename($e->getFile()), 'line' => $e->getLine()]);
        echo json_encode([
            'success' => false, 
            'message' => '保存失败：' . $e->getMessage(),
        ], JSON_UNESCAPED_UNICODE);
    }
}

function deleteApiConfig() {
    $db = getDB();
    // 清除所有已保存的配置（将 is_active 全部设为 0）
    $db->exec("UPDATE api_config SET is_active = 0");
    echo json_encode(['success' => true, 'message' => 'API配置已清除'], JSON_UNESCAPED_UNICODE);
}

function getApiConfig() {
    $db = getDB();
    $result = $db->querySingle("SELECT * FROM api_config WHERE is_active = 1 ORDER BY id DESC LIMIT 1", true);

    if ($result) {
        $decrypted = decryptData($result['api_key']);
        $keyLen = strlen($decrypted);
        // 返回掩码用于展示（前4位 + **** + 后4位）
        if ($keyLen > 8) {
            $result['api_key_masked'] = substr($decrypted, 0, 4) . '****' . substr($decrypted, -4);
        } elseif ($keyLen > 0) {
            $result['api_key_masked'] = substr($decrypted, 0, 2) . '****' . substr($decrypted, -2);
        } else {
            $result['api_key_masked'] = '(空)';
        }
        // 不返回真实 Key，只返回掩码
        $result['api_key'] = '••••••••' . substr($decrypted, -4);
    }

    // ============ 读取最新模型检测结果 ============
    $modelCheckSummary = null;
    try {
        $checkRow = $db->querySingle("SELECT config_value FROM system_config WHERE config_key = 'model_check_result'", true);
        if ($checkRow && $checkRow['config_value']) {
            $modelCheckSummary = json_decode($checkRow['config_value'], true);
        }
    } catch (\Throwable $e) {
        // 静默处理，不影响主流程
    }

    echo json_encode([
        'success' => true,
        'data' => $result ?: null,
        'models' => array_keys(AVAILABLE_MODELS),
        'model_check' => $modelCheckSummary,
    ], JSON_UNESCAPED_UNICODE);
}

// ============================================================
//  非流式生成反馈（保留兼容）
// ============================================================
function generateFeedback() {
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $db = getDB();
    $config = $db->querySingle("SELECT * FROM api_config WHERE is_active = 1 ORDER BY id DESC LIMIT 1", true);

    if (!$config) {
        echo json_encode(['success' => false, 'message' => '请先配置千问API参数'], JSON_UNESCAPED_UNICODE);
        return;
    }

    $apiKey = decryptData($config['api_key']);
    $prompt = buildPrompt($input);
    $response = callQwenAPI($apiKey, $config['model'], $prompt, $config['temperature'], $config['max_tokens']);

    if ($response['success']) {
        $usage = $response['usage'] ?? ['prompt_tokens' => 0, 'completion_tokens' => 0, 'total_tokens' => 0];
        $now = date('Y-m-d H:i:s');
        
        // 使用统一的维度保存函数
        $dimensionMap = buildDimensionMap($input);
        $fields = array_keys(DIMENSION_KEYS);
        $columns = ['student_name', 'student_level', 'student_grade', 'teaching_content', 'teaching_scene', 'homework_assign', 'custom_note'];
        $columns = array_merge($columns, $fields);
        $columns = array_merge($columns, ['generated_feedback', 'model_used', 'prompt_tokens', 'completion_tokens', 'total_tokens', 'created_at']);
        
        $placeholders = array_map(fn($c) => ':' . $c, $columns);
        $sql = "INSERT INTO feedback_history (" . implode(', ', $columns) . ") VALUES (" . implode(', ', $placeholders) . ")";
        
        $stmt = $db->prepare($sql);
        $stmt->bindValue(':student_name', $input['student_name'] ?? '', SQLITE3_TEXT);
        $stmt->bindValue(':student_level', $input['student_level'] ?? '', SQLITE3_TEXT);
        $stmt->bindValue(':student_grade', $input['student_grade'] ?? '', SQLITE3_TEXT);
        $stmt->bindValue(':teaching_content', $input['teaching_content'] ?? '', SQLITE3_TEXT);
        $stmt->bindValue(':teaching_scene', $input['teaching_scene'] ?? '', SQLITE3_TEXT);
        $stmt->bindValue(':homework_assign', $input['homework_assign'] ?? '', SQLITE3_TEXT);
        $stmt->bindValue(':custom_note', $input['custom_note'] ?? '', SQLITE3_TEXT);
        
        foreach ($fields as $key) {
            $stmt->bindValue(':' . $key, $input[$key] ?? '', SQLITE3_TEXT);
        }
        
        $stmt->bindValue(':generated_feedback', $response['content'], SQLITE3_TEXT);
        $stmt->bindValue(':model_used', $config['model'], SQLITE3_TEXT);
        $stmt->bindValue(':prompt_tokens', intval($usage['prompt_tokens'] ?? 0), SQLITE3_INTEGER);
        $stmt->bindValue(':completion_tokens', intval($usage['completion_tokens'] ?? 0), SQLITE3_INTEGER);
        $stmt->bindValue(':total_tokens', intval($usage['total_tokens'] ?? 0), SQLITE3_INTEGER);
        $stmt->bindValue(':created_at', $now, SQLITE3_TEXT);
        $stmt->execute();

        echo json_encode([
            'success' => true,
            'feedback' => $response['content'],
            'model' => $config['model'],
            'id' => $db->lastInsertRowID(),
            'usage' => $usage,
        ], JSON_UNESCAPED_UNICODE);
    } else {
        echo json_encode(['success' => false, 'message' => $response['message']], JSON_UNESCAPED_UNICODE);
    }
}

// ============================================================
//  数据清洗：去重、去矛盾
// ============================================================
function cleanInputData($input) {
    // 1. 修剪所有字符串字段，并移除不可见控制字符
    foreach ($input as $key => $value) {
        if (is_string($value)) {
            // 移除BOM、零宽字符等
            $input[$key] = trim(preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', $value));
        }
    }

    // 2. 维度去重：检查是否同一个维度选了多个意思相近的选项（前端多选）
    $dimensionKeys = array_keys(DIMENSION_KEYS);

    foreach ($dimensionKeys as $key) {
        if (!empty($input[$key])) {
            $value = $input[$key];
            // 多选用逗号分隔
            if (mb_strpos($value, '，') !== false || mb_strpos($value, ',') !== false) {
                $parts = preg_split('/[，,]/u', $value);
                $parts = array_map('trim', $parts);
                $parts = array_unique($parts);
                $input[$key] = implode('，', $parts);
            }
        }
    }

    // 3. 检查 custom_note 和维度是否有明显矛盾
    //    例如 custom_note 说"上课吃东西"，但 attention_status 说"全程专注"
    //    这种情况不修改数据，但在 prompt 中提示 AI 处理这种矛盾
    $customNote = $input['custom_note'] ?? '';
    $attention = $input['attention_status'] ?? '';
    
    if ($customNote && $attention) {
        $hasConflict = false;
        // 简单检查：如果注意力是正面的，但补充说明提到负面行为
        $positiveAttn = ['认真', '专注', '好', '集中', '主动', '积极', '跟住', '饱满', '思维活跃'];
        $negativeNote = ['吃', '玩', '手机', '走神', '分心', '说话', '闹', '不认真', '睡觉'];
        
        $isAttnPositive = false;
        foreach ($positiveAttn as $word) {
            if (mb_strpos($attention, $word) !== false) {
                $isAttnPositive = true;
                break;
            }
        }
        
        $isNoteNegative = false;
        foreach ($negativeNote as $word) {
            if (mb_strpos($customNote, $word) !== false) {
                $isNoteNegative = true;
                break;
            }
        }
        
        if ($isAttnPositive && $isNoteNegative) {
            // 标记矛盾，让 AI 妥善处理
            $input['_has_conflict'] = true;
            $input['_conflict_detail'] = "听课状态评价为正面（{$attention}），但补充说明提到负面行为（{$customNote}），请在反馈中妥善处理：可以先肯定好的方面，再温和提及补充说明中的问题。";
        }
    }

    // 4. XSS防护：移除用户输入中的HTML标签
    $htmlFields = ['student_name', 'teaching_content', 'homework_assign', 'custom_note'];
    foreach ($htmlFields as $field) {
        if (isset($input[$field]) && is_string($input[$field])) {
            $input[$field] = strip_tags($input[$field]);
        }
    }

    return $input;
}

// ============================================================
//  构建AI提示词
// ============================================================
function buildPrompt($input) {
    // 使用统一的维度提取函数
    $dimensionMap = buildDimensionMap($input);
    $filledCount = count($dimensionMap);
    
    $teaching    = $input['teaching_content'] ?? '';
    $homeworkAssign = $input['homework_assign'] ?? '';
    $customNote  = $input['custom_note'] ?? '';
    $studentLevel = $input['student_level'] ?? '';
    $teachingScene = $input['teaching_scene'] ?? '';
    $feedbackDate = $input['feedback_date'] ?? '';
    $wordCountRange = $input['word_count_range'] ?? '200-400';
    // 解析字数范围
    $rangeParts = explode('-', $wordCountRange);
    $wordMin = intval($rangeParts[0] ?? 200);
    $wordMax = intval($rangeParts[1] ?? 400);

    // 根据教学场景添加针对性指导
    $sceneGuidance = '';
    if ($teachingScene === 'one_on_one') {
        $sceneGuidance = "\n【场景：一对一辅导】\n反馈要更加个性化和细致，可以提到孩子课堂上的具体表现和反应，让家长感受到你对孩子的深度关注。语气保持平实客观。";
    } elseif ($teachingScene === 'small_group') {
        $sceneGuidance = "\n【场景：小班课】\n可以适当提及班级的整体氛围，但在反馈中突出该学生的个体表现，让家长觉得'老师心里有我家孩子'。";
    } elseif ($teachingScene === 'large_group') {
        $sceneGuidance = "\n【场景：大班课】\n反馈要简洁有力，抓住最核心的1-2个亮点和1个改进点即可，不必面面俱到。";
    } elseif ($teachingScene === 'online') {
        $sceneGuidance = "\n【场景：线上课】\n可以提到网络、设备等线上课特有情况，关注孩子是否适应线上学习模式，是否需要家长在旁边协助监督。";
    } elseif ($teachingScene === 'exam_review') {
        $sceneGuidance = "\n【场景：考前冲刺/复习】\n突出考试重点的掌握情况，分析哪些题型已经过关、哪些还需加强，给家长一个清晰的考前复习方向。语气可以比平时更正式一些。";
    } elseif ($teachingScene === 'holiday_camp') {
        $sceneGuidance = "\n【场景：寒暑假集训】\n反馈可以更长一些，总结孩子在集训期间的整体状态变化，强调连续性学习的效果，给家长看到集训的价值。";
    }

    // 公共规范（消除与 buildBatchPrompt 的重复）
    $styleGuidelines = getStyleGuidelines();
    $professionalGuidelines = getProfessionalGuidelines();

    $systemPrompt = <<<PROMPT
你是一位在数学培训机构任教多年的专业辅导老师。每次课后你需要给家长发送一段微信消息风格的课后反馈。

【核心原则：信息真实性】
你只能使用下面"用户提供的信息"中明确给出的内容。严禁添加任何用户未提及的信息，包括但不限于：具体的题目编号、页码、正确题数/错误题数、学生说的具体话语、举手次数等课堂行为细节。如果用户提供的信息不足以支撑某个结论，不要编造。

【角色定位】
你是一位专业、客观、有经验的辅导老师。你了解这个孩子，对ta的课堂表现了然于心，既能看到闪光点也能准确指出不足。你的语气是专业平和的——不夸张、不煽情、不刻意套近乎，让家长感受到你是真的在关注孩子的成长。

【输出格式（必须严格遵守）】
第一行：{$feedbackDate} 课堂反馈

授课内容
用1-2句话简述本节课讲的知识点或训练的方法。只基于用户填写的授课内容来描述。

课堂表现
采用"先肯定→过渡"的结构：
- 开头：肯定孩子1-2个具体好的表现（从评价维度中提取）
- 中间：自然过渡到需要提升的方面，用温和但准确的语言描述课堂上的问题
- 必须覆盖用户提供的所有评价维度（包括作业完成情况、听课状态、随堂练习、基础知识、公式掌握情况、做题技巧与速度、解题思路、计算能力等），每个已填写的维度都要在反馈中有所体现，不能遗漏
要点：只描述课堂上观察到的实际表现，不要给出课后练习建议或训练方案。课后作业由老师在"作业"部分统一布置。始终用评价维度中提供的具体描述，不要泛泛说"表现不错"或"需要努力"。

作业
直接列出布置的作业内容。如果没有布置作业则说明"本次未布置作业"，并根据本次课堂表现给出1条自主复习建议（基于具体薄弱点）。作业部分结束即止，不要加任何鼓励语、加油、期待等结尾。

{$styleGuidelines}

【字数控制】
控制在{$wordMin}-{$wordMax}字。不要为凑字数而重复、啰嗦或编造信息。信息量少时简短务实即可，信息丰富时精炼概括、抓住重点。

【不同学生状态的处理策略】
- 整体表现优秀：肯定2个具体闪光点 + 提1个仍可提升的方向（给家长展示你对孩子有更高期待）
- 好坏参半：先肯定好的方面（至少1个）→ 自然过渡到需要改进的地方
- 问题较多：先找到1个闪光点给信心 → 分点说明需要提升的方面（按优先级排列）
- 有犯困/走神/溜号：温和提及，先关心是否休息不足 → 请家长配合观察
- 有进步趋势：用"之前...这节..."的对比突出具体变化，让家长看到成长轨迹
- 有学习习惯问题：描述具体表现 → 肯定孩子有能力改好

{$professionalGuidelines}

请基于以下信息生成反馈：
PROMPT;

    // ============ 使用统一函数构建维度列表 ============
    $dimensionLines = buildDimensionLines($dimensionMap);

    // ============ 动态字数：信息少则降低目标 ============
    // 根据填写的信息量自适应调整字数范围，避免信息少时硬凑字数导致编造
    $hasExtra = ($homeworkAssign || $customNote) ? 1 : 0;
    $infoDensity = $filledCount + $hasExtra + ($teaching ? 1 : 0);
    
    if ($infoDensity <= 2) {
        // 信息极少：80-150字，简短但必须覆盖所有已填维度
        $wordMin = 80;
        $wordMax = 150;
    } elseif ($infoDensity <= 4) {
        // 信息较少：100-200字
        $wordMin = max($wordMin, 100);
        $wordMax = min($wordMax, 200);
    } elseif ($infoDensity <= 6) {
        // 信息适中：保持用户选择的字数范围，但适当缩窄
        $wordMin = max($wordMin, 120);
    }
    // 信息丰富（>6）：完全使用用户选择的字数范围，不调整

    $userContent = "【授课内容】\n" . ($teaching ?: '未填写') . "\n\n";

    if ($studentLevel) {
        $userContent .= "【学生水平】{$studentLevel}\n";
        $userContent .= "（优秀生重在拔高表扬，薄弱生重在鼓励打基础，语气温和）\n\n";
    }

    if ($sceneGuidance) {
        $userContent .= $sceneGuidance . "\n\n";
    }

    $userContent .= "【课堂评价维度】\n";
    if (!empty($dimensionLines)) {
        $userContent .= $dimensionLines . "\n";
    } else {
        $userContent .= "（未填写）\n";
    }

    if ($homeworkAssign) $userContent .= "\n【布置作业】\n{$homeworkAssign}\n";
    if ($customNote)     $userContent .= "\n【补充说明】\n{$customNote}\n";

    $userContent .= "\n请严格按照以下格式输出反馈：\n";
    $userContent .= "第一行：{$feedbackDate} 课堂反馈\n";
    $userContent .= "然后分三段，每段带上小标题（不要加星号或其他Markdown标记）：\n";
    $userContent .= "授课内容\n（简述本节课讲的知识点/方法）\n\n";
    $userContent .= "课堂表现\n（结合评价维度，只描述课堂上观察到的实际表现，先肯定好的方面，再指出需要改进的地方。必须覆盖所有已填写的评价维度，不要遗漏。不要给课后练习建议）\n\n";
    $userContent .= "作业\n（布置的作业内容。无作业则说明并给复习建议。作业部分结束即止，不要加鼓励语）\n\n";
    $userContent .= "【字数要求】控制在{$wordMin}-{$wordMax}字。";
    
    if ($filledCount <= 2) {
        $userContent .= "当前信息较少，反馈简短温馨即可，不要为了凑字数而编造细节。";
    } elseif ($filledCount >= 7) {
        $userContent .= "信息较丰富，请合理取舍、精炼概括，抓住最重要的点。";
    }
    
    $userContent .= "\n【素材原则】只使用上面提供的信息，严禁编造题目编号、页码、学生具体言行、练习对错数量等未提供的内容。";
    $userContent .= "\n【语义去重】教师可能在不同维度中选择了语义相近的选项（如\"作业全部完成\"和\"作业全部完成，正确率高\"），请自动合并这些重复信息，取其最精确的描述，避免在反馈中重复啰嗦。";

    // ============ 年级知识范围约束 ============
    $studentGrade = $input['student_grade'] ?? '';
    if ($studentGrade) {
        $gradeConstraint = buildGradeConstraint($studentGrade, $teaching);
        if ($gradeConstraint) {
            $userContent .= "\n\n" . $gradeConstraint;
        }
    }

    // ============ 进步对比：自动查找上次反馈 ============
    $studentName = $input['student_name'] ?? '';
    if ($studentName && !isset($input['progress_trend']) && !($input['progress_trend'] ?? '')) {
        // 用户没有手动填写进步趋势时，尝试从历史记录中自动获取上次反馈
        $lastFeedback = getLastFeedback($studentName);
        if ($lastFeedback) {
            // 截取关键信息（最多300字，避免prompt过长）
            $lastFeedbackExcerpt = mb_strlen($lastFeedback) > 300 
                ? mb_substr($lastFeedback, 0, 300) . '...' 
                : $lastFeedback;
            $userContent .= "\n\n【上次反馈参考】以下是该学生上一次的课后反馈（仅供对比参考，如果本次信息与上次有明显进步或变化，可在反馈中用\"相比上次...\"自然提及；如果无明显变化则不提及）：\n{$lastFeedbackExcerpt}";
        }
    }

    // 如果有数据矛盾标记，追加处理提示
    if (!empty($input['_has_conflict']) && !empty($input['_conflict_detail'])) {
        $userContent .= "\n\n【矛盾提示】{$input['_conflict_detail']}";
    }

    return [
        ['role' => 'system', 'content' => $systemPrompt],
        ['role' => 'user', 'content' => $userContent]
    ];
}

// ============================================================
//  构建小班课批量反馈的Prompt
// ============================================================
function buildBatchPrompt($students, $teachingContent, $input, $feedbackDate, $wordMin, $wordMax, $studentGrade) {
    $homeworkAssign = $input['homework_assign'] ?? '';
    $customNote = $input['custom_note'] ?? '';

    // 公共规范（消除与 buildPrompt 的重复）
    $styleGuidelines = getStyleGuidelines();
    $professionalGuidelines = getProfessionalGuidelines();

    $sceneType = ($input['teaching_scene'] ?? 'small_group') === 'large_group' ? '大班课' : '小班课';
    $sceneGuidance = $sceneType === '大班课' 
        ? "反馈要简洁有力，抓住每位学生最核心的1-2个亮点和1个改进点即可，不必面面俱到。"
        : "反馈要体现班级整体教学情况，同时突出每位学生的个体表现差异，让每位家长感受到老师对自己孩子的关注。";
    $studentCount = count($students);
    $perStudentWords = intval($wordMax / max($studentCount, 1));
    $totalWordConstraint = "整体反馈控制在{$wordMin}-{$wordMax}字以内，每位学生的反馈约{$perStudentWords}字左右。不要为凑字数而重复、啰嗦或编造信息。";

    $systemPrompt = <<<PROMPT
你是一位在数学培训机构任教多年的专业辅导老师。你现在要给一个「{$sceneType}」的家长们发送课后反馈。

【核心原则：信息真实性】
你只能使用下面"用户提供的信息"中明确给出的内容。严禁添加任何用户未提及的信息，包括但不限于：具体的题目编号、页码、正确题数/错误题数、学生说的具体话语、举手次数等课堂行为细节。

【输出格式（必须严格遵守）】
整体以以下结构输出：

{$feedbackDate} 课堂反馈

授课内容
（简述本节课讲的知识点和内容，全班统一）

课堂表现
（按以下格式为每位学生单独一段，每位学生直接以名字开头，不要加"——"等分隔符）：
学生姓名：
（该学生的具体课堂表现，只描述课堂上观察到的实际表现，先肯定好的方面，再指出需改进的地方。不要给课后练习建议）

下一位学生姓名：
（该学生的具体课堂表现...）
...

作业
（全班统一的作业内容）

【每位学生反馈的写法要求】
- 采用"先肯定→过渡→建议"的结构
- 肯定1-2个具体好的表现（从评价维度中提取）
- 温和但准确地描述需要提升的方面
- 给1-2条具体可操作的建议

{$styleGuidelines}

【字数控制】
{$totalWordConstraint}

{$professionalGuidelines}

请基于以下信息生成反馈：
PROMPT;

    $userContent = "【授课内容】\n" . ($teachingContent ?: '未填写') . "\n\n";

    // 年级信息
    if ($studentGrade) {
        $userContent .= "【学生年级】{$studentGrade}\n\n";
    }

    // 场景指导
    $userContent .= "【场景：{$sceneType}】\n{$sceneGuidance}\n\n";

    // 每位学生的信息
    $userContent .= "【学生列表】\n";
    foreach ($students as $index => $s) {
        $name = $s['student_name'] ?? "学生" . ($index + 1);
        $level = $s['student_level'] ?? '';
        $dims = $s['dims'] ?? [];

        $userContent .= "\n{$name}：\n";
        if ($level) {
            $levelHint = '';
            if ($level === '优秀') $levelHint = '（优秀生，重在拔高表扬）';
            elseif ($level === '良好') $levelHint = '（良好，肯定优点同时给出提升建议）';
            elseif ($level === '中等') $levelHint = '（中等，多鼓励，指出可提升方向）';
            elseif ($level === '薄弱') $levelHint = '（薄弱，重在鼓励打基础，语气温和）';
            $userContent .= "水平：{$level}{$levelHint}\n";
        }
        if (!empty($dims)) {
            $dimLines = [];
            foreach ($dims as $dimId => $dimVal) {
                $dimTitle = getDimTitle($dimId);
                $dimLines[] = "{$dimTitle}：{$dimVal}";
            }
            $userContent .= implode("\n", $dimLines) . "\n";
        } else {
            $userContent .= "（未填写评价维度）\n";
        }
    }

    if ($homeworkAssign) $userContent .= "\n【布置作业】\n{$homeworkAssign}\n";
    if ($customNote)     $userContent .= "\n【补充说明】\n{$customNote}\n";

    // 年级约束
    if ($studentGrade) {
        $gradeConstraint = buildGradeConstraint($studentGrade, $teachingContent);
        if ($gradeConstraint) {
            $userContent .= "\n" . $gradeConstraint;
        }
    }

    $userContent .= "\n请严格按照格式输出，每位学生的反馈独立成段。\n";
    $userContent .= "【整体字数】{$totalWordConstraint}";

    return [
        ['role' => 'system', 'content' => $systemPrompt],
        ['role' => 'user', 'content' => $userContent]
    ];
}

// 获取维度中文标题
function getDimTitle($dimId) {
    // 直接使用统一的 DIMENSION_KEYS 常量，避免重复维护
    if (defined('DIMENSION_KEYS') && isset(DIMENSION_KEYS[$dimId])) {
        return DIMENSION_KEYS[$dimId];
    }
    // 回退：如果常量未加载，使用内置映射
    $map = [
        'homework_status' => '作业完成情况',
        'attention_status' => '听课状态/注意力',
        'interaction_status' => '课堂互动参与',
        'drowsy_status' => '犯困情况',
        'daydream_status' => '溜号情况',
        'exercise_status' => '随堂练习情况',
        'basic_knowledge' => '基础知识掌握',
        'skill_speed' => '做题技巧与速度',
        'analysis_ability' => '分析/解题能力',
        'calculation_ability' => '计算能力',
        'study_habit' => '学习习惯',
        'progress_trend' => '进步趋势',
        'math_thinking' => '数学思维',
    ];
    return $map[$dimId] ?? $dimId;
}

/**
 * 从批量生成的全文反馈中，提取某位学生的专属段落
 * AI 输出格式为直接以学生姓名开头，到下一个学生姓名或"作业"段落结束
 * @return string|null 提取的段落，提取失败返回 null
 */
function extractStudentFeedback($fullContent, $studentName) {
    if (empty($fullContent) || empty($studentName)) return null;
    
    $escapedName = preg_quote($studentName, '/');
    
    // 匹配：姓名行开头 → 到下一个学生姓名 或 "作业" 或文本结尾
    if (preg_match('/' . $escapedName . '[：:]?\s*\n?(.*?)(?=\n\s*(?:[^\s]{1,10}[：:]|作业|$)|\Z)/us', $fullContent, $matches)) {
        $section = trim($matches[1]);
        if (mb_strlen($section) > 20) return $section;
    }
    
    // 兼容旧格式 "——学生姓名："
    if (preg_match('/——\s*' . $escapedName . '[：:]?\s*\n?(.*?)(?=\n\s*(?:——|作业|$)|\Z)/us', $fullContent, $matches)) {
        $section = trim($matches[1]);
        if (mb_strlen($section) > 20) return $section;
    }
    
    return null;
}

// 批量保存每位学生的历史记录（复用与 saveStreamRecord 相同的表结构和逻辑）
function saveBatchRecords($fullContent, $students, $input, $usage, $model) {
    $db = getDB();
    $now = date('Y-m-d H:i:s');

    // 为每位学生保存一条记录
    foreach ($students as $s) {
        $studentName = $s['student_name'] ?? '未知';
        $studentLevel = $s['student_level'] ?? '';
        $dims = $s['dims'] ?? [];

        // 尝试从全文中提取该学生的专属反馈段落
        $studentFeedback = extractStudentFeedback($fullContent, $studentName);

        // 构建与 saveStreamRecord 一致的字段结构
        $recordData = [
            'student_name'      => $studentName,
            'student_level'     => $studentLevel,
            'student_grade'     => $input['student_grade'] ?? '',
            'teaching_content'  => $input['teaching_content'] ?? '',
            'teaching_scene'    => $input['teaching_scene'] ?? 'small_group',
            'homework_assign'   => $input['homework_assign'] ?? '',
            'custom_note'       => $input['custom_note'] ?? '',
        ];
        // 展开维度值
        foreach ($dims as $dimId => $dimVal) {
            $recordData[$dimId] = $dimVal;
        }

        // 使用与 saveStreamRecord 相同的字段构建方式
        $dimensionMap = buildDimensionMap($recordData);
        $fields = array_keys(DIMENSION_KEYS);
        $columns = ['student_name', 'student_level', 'student_grade', 'teaching_content', 'teaching_scene', 'homework_assign', 'custom_note'];
        $columns = array_merge($columns, $fields);
        $columns = array_merge($columns, ['generated_feedback', 'model_used', 'prompt_tokens', 'completion_tokens', 'total_tokens', 'created_at']);

        $placeholders = array_map(fn($c) => ':' . $c, $columns);
        $sql = "INSERT INTO feedback_history (" . implode(', ', $columns) . ") VALUES (" . implode(', ', $placeholders) . ")";

        try {
            $stmt = $db->prepare($sql);
            $stmt->bindValue(':student_name', $studentName, SQLITE3_TEXT);
            $stmt->bindValue(':student_level', $studentLevel, SQLITE3_TEXT);
            $stmt->bindValue(':student_grade', $input['student_grade'] ?? '', SQLITE3_TEXT);
            $stmt->bindValue(':teaching_content', $input['teaching_content'] ?? '', SQLITE3_TEXT);
            $stmt->bindValue(':teaching_scene', $input['teaching_scene'] ?? 'small_group', SQLITE3_TEXT);
            $stmt->bindValue(':homework_assign', $input['homework_assign'] ?? '', SQLITE3_TEXT);
            $stmt->bindValue(':custom_note', $input['custom_note'] ?? '', SQLITE3_TEXT);

            foreach ($fields as $key) {
                $stmt->bindValue(':' . $key, $recordData[$key] ?? '', SQLITE3_TEXT);
            }

            // 优先保存该学生专属反馈段落，提取失败则保存全文
            $stmt->bindValue(':generated_feedback', $studentFeedback ?: $fullContent, SQLITE3_TEXT);
            $stmt->bindValue(':model_used', $model, SQLITE3_TEXT);
            $stmt->bindValue(':prompt_tokens', intval($usage['prompt_tokens'] ?? 0), SQLITE3_INTEGER);
            $stmt->bindValue(':completion_tokens', intval($usage['completion_tokens'] ?? 0), SQLITE3_INTEGER);
            $stmt->bindValue(':total_tokens', intval($usage['total_tokens'] ?? 0), SQLITE3_INTEGER);
            $stmt->bindValue(':created_at', $now, SQLITE3_TEXT);
            $stmt->execute();
        } catch (\Exception $e) {
            logError('saveBatchRecords 失败: ' . $e->getMessage(), ['student' => $studentName]);
            // 向用户发送可见提示
            sendSSE('error', "保存学生「{$studentName}」的历史记录失败，请检查数据库权限：" . $e->getMessage());
        }
    }
}

// ============================================================
//  调用千问API（非流式）
// ============================================================
function callQwenAPI($apiKey, $model, $messages, $temperature, $maxTokens) {
    $body = json_encode([
        'model' => $model,
        'messages' => $messages,
        'temperature' => $temperature,
        'max_tokens' => $maxTokens,
    ], JSON_UNESCAPED_UNICODE);

    if ($body === false) {
        return ['success' => false, 'message' => 'JSON编码失败：' . json_last_error_msg()];
    }

    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL            => QWEN_API_URL,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $body,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json; charset=utf-8',
            'Authorization: Bearer ' . $apiKey,
            'Content-Length: ' . strlen($body),
        ],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 90,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTP_VERSION   => CURL_HTTP_VERSION_1_1,
        CURLOPT_ENCODING       => '',
        CURLOPT_IPRESOLVE      => CURL_IPRESOLVE_V4,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 3,
    ]);

    $response  = curl_exec($ch);
    $httpCode  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    $curlErrno = curl_errno($ch);
    curl_close($ch);

    if ($curlErrno) {
        $errorMsg = match($curlErrno) {
            CURLE_OPERATION_TIMEOUTED  => '请求超时，请稍后重试',
            CURLE_COULDNT_RESOLVE_HOST => '无法解析域名，请检查服务器DNS配置',
            CURLE_COULDNT_CONNECT      => '无法连接到千问API，请检查服务器网络/防火墙',
            CURLE_SSL_CONNECT_ERROR    => 'SSL连接失败',
            CURLE_GOT_NOTHING          => '服务器无响应，可能是防火墙拦截',
            default                    => '网络请求失败 [' . $curlErrno . ']：' . $curlError,
        };
        return ['success' => false, 'message' => $errorMsg];
    }

    if ($response === false || $response === '') {
        return ['success' => false, 'message' => 'API返回空响应，HTTP状态码：' . $httpCode];
    }

    $result = json_decode($response, true);
    if ($result === null) {
        $preview = mb_substr($response, 0, 200);
        return ['success' => false, 'message' => 'API返回格式异常（状态码：' . $httpCode . '），响应：' . $preview];
    }

    if ($httpCode !== 200) {
        $errorMsg = $result['message'] ?? $result['error']['message'] ?? $result['code'] ?? "请求失败，HTTP状态码：{$httpCode}";
        return ['success' => false, 'message' => 'API错误：' . $errorMsg];
    }

    $content = $result['choices'][0]['message']['content'] ?? '';
    if (empty($content)) {
        return ['success' => false, 'message' => 'AI返回内容为空，请重试'];
    }

    // 提取usage信息
    $usage = $result['usage'] ?? ['prompt_tokens' => 0, 'completion_tokens' => 0, 'total_tokens' => 0];

    return ['success' => true, 'content' => $content, 'usage' => $usage];
}

// ============================================================
//  历史记录
// ============================================================
function getHistory() {
    $db = getDB();

    // 获取单条完整记录
    $detailId = intval($_GET['detail'] ?? 0);
    if ($detailId > 0) {
        $stmt = $db->prepare("SELECT * FROM feedback_history WHERE id = :id");
        $stmt->bindValue(':id', $detailId, SQLITE3_INTEGER);
        $row = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
        if ($row) {
            echo json_encode(['success' => true, 'data' => $row], JSON_UNESCAPED_UNICODE);
        } else {
            echo json_encode(['success' => false, 'message' => '记录不存在'], JSON_UNESCAPED_UNICODE);
        }
        return;
    }

    $page = max(1, intval($_GET['page'] ?? 1));
    $limit = 20;
    $offset = ($page - 1) * $limit;
    $search = trim($_GET['search'] ?? '');
    $searchStudent = trim($_GET['student'] ?? '');

    // 构建查询条件
    $whereClause = '';
    $params = [];
    if ($search !== '') {
        $whereClause = "WHERE (student_name LIKE :search OR teaching_content LIKE :search2)";
        $params[':search'] = "%{$search}%";
        $params[':search2'] = "%{$search}%";
    } elseif ($searchStudent !== '') {
        $whereClause = "WHERE student_name = :student";
        $params[':student'] = $searchStudent;
    }

    // 统计总数（使用预编译语句绑定参数）
    $countSql = "SELECT COUNT(*) FROM feedback_history {$whereClause}";
    $countStmt = $db->prepare($countSql);
    foreach ($params as $key => $val) {
        $countStmt->bindValue($key, $val, SQLITE3_TEXT);
    }
    $total = $countStmt->execute()->fetchArray(SQLITE3_NUM)[0] ?? 0;

    $sql = "SELECT id, student_name, student_level, teaching_content, model_used, prompt_tokens, completion_tokens, total_tokens, created_at FROM feedback_history {$whereClause} ORDER BY id DESC LIMIT :limit OFFSET :offset";
    $stmt = $db->prepare($sql);
    foreach ($params as $key => $val) {
        $stmt->bindValue($key, $val, SQLITE3_TEXT);
    }
    $stmt->bindValue(':limit', $limit, SQLITE3_INTEGER);
    $stmt->bindValue(':offset', $offset, SQLITE3_INTEGER);
    $results = $stmt->execute();

    $items = [];
    while ($row = $results->fetchArray(SQLITE3_ASSOC)) {
        $row['teaching_content_preview'] = mb_substr($row['teaching_content'] ?: '流式生成', 0, 40) . (mb_strlen($row['teaching_content'] ?: '') > 40 ? '...' : '');
        $items[] = $row;
    }

    echo json_encode([
        'success' => true,
        'data' => $items,
        'total' => $total,
        'page' => $page,
        'totalPages' => ceil($total / $limit)
    ], JSON_UNESCAPED_UNICODE);
}

function deleteHistory() {
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $id = intval($input['id'] ?? 0);

    if ($id <= 0) {
        echo json_encode(['success' => false, 'message' => '无效的ID'], JSON_UNESCAPED_UNICODE);
        return;
    }

    $db = getDB();
    $stmt = $db->prepare("DELETE FROM feedback_history WHERE id = :id");
    $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
    $stmt->execute();
    echo json_encode(['success' => true, 'message' => '删除成功'], JSON_UNESCAPED_UNICODE);
}

function deleteHistoryBatch() {
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $ids = $input['ids'] ?? [];

    if (!is_array($ids) || count($ids) === 0) {
        echo json_encode(['success' => false, 'message' => '请选择要删除的记录'], JSON_UNESCAPED_UNICODE);
        return;
    }

    // 过滤并转整数
    $safeIds = array_map('intval', $ids);
    $safeIds = array_filter($safeIds, function($v) { return $v > 0; });

    if (count($safeIds) === 0) {
        echo json_encode(['success' => false, 'message' => '无效的记录ID'], JSON_UNESCAPED_UNICODE);
        return;
    }

    $db = getDB();
    // 使用预编译语句逐个删除，避免SQL注入
    $stmt = $db->prepare("DELETE FROM feedback_history WHERE id = :id");
    $deleted = 0;
    foreach ($safeIds as $id) {
        $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
        $stmt->execute();
        $deleted += $db->changes();
        $stmt->reset();
    }

    echo json_encode([
        'success' => true,
        'message' => "成功删除 {$deleted} 条记录",
        'deleted' => $deleted
    ], JSON_UNESCAPED_UNICODE);
}

// ============================================================
//  学生档案：按学生聚合历史反馈
// ============================================================
function getStudentProfile() {
    $db = getDB();

    // 返回所有学生的统计概览（含维度分析）
    $students = $db->query("
        SELECT 
            student_name,
            MAX(student_level) as student_level,
            MAX(student_grade) as student_grade,
            COUNT(*) as feedback_count,
            MAX(created_at) as last_feedback_time,
            MIN(created_at) as first_feedback_time,
            COALESCE(SUM(total_tokens), 0) as total_tokens,
            GROUP_CONCAT(DISTINCT model_used) as models_used
        FROM feedback_history 
        WHERE student_name != '' 
        GROUP BY student_name 
        ORDER BY last_feedback_time DESC
    ");

    $profiles = [];
    while ($row = $students->fetchArray(SQLITE3_ASSOC)) {
        // 统计该学生各维度的评价趋势（最近5次反馈中正面/负面评价占比）
        $studentName = $row['student_name'];
        $stmt = $db->prepare("
            SELECT 
                attention_status, homework_status, exercise_status, 
                basic_knowledge, calculation_ability, analysis_ability,
                study_habit, progress_trend
            FROM feedback_history 
            WHERE student_name = :name 
            ORDER BY id DESC 
            LIMIT 5
        ");
        $stmt->bindValue(':name', $studentName, SQLITE3_TEXT);
        $recentResults = $stmt->execute();
        
        $positiveCount = 0;
        $totalCount = 0;
        $positiveKeywords = ['好', '优秀', '出色', '扎实', '专注', '积极', '正确', '强', '进步', '清晰', '饱满'];
        $negativeKeywords = ['弱', '差', '不足', '欠缺', '薄弱', '马虎', '走神', '犯困', '分心', '错误较多', '偏低'];
        
        while ($recentRow = $recentResults->fetchArray(SQLITE3_ASSOC)) {
            foreach ($recentRow as $field => $value) {
                if (empty($value) || $value === '未评价') continue;
                $totalCount++;
                $isPositive = false;
                $isNegative = false;
                foreach ($positiveKeywords as $kw) {
                    if (mb_strpos($value, $kw) !== false) { $isPositive = true; break; }
                }
                foreach ($negativeKeywords as $kw) {
                    if (mb_strpos($value, $kw) !== false) { $isNegative = true; break; }
                }
                if ($isPositive && !$isNegative) $positiveCount++;
            }
        }
        
        $row['trend_score'] = $totalCount > 0 ? round($positiveCount / $totalCount * 100) : 0;
        
        $profiles[] = $row;
    }

    echo json_encode([
        'success' => true,
        'data' => $profiles,
        'total' => count($profiles)
    ], JSON_UNESCAPED_UNICODE);
}

// ============================================================
//  加密工具
// ============================================================
function encryptData($data) {
    // 优先使用环境变量，回退到默认值
    // ⚠️ 安全警告：生产环境务必设置 ENCRYPTION_KEY 环境变量，避免使用默认密钥
    $rawKey = getenv('ENCRYPTION_KEY') ?: 'teacher_feedback_2024_secret_salt!';
    if (!getenv('ENCRYPTION_KEY')) {
        static $encryptionWarningLogged = false;
        if (!$encryptionWarningLogged) {
            logError('⚠️ 安全警告：ENCRYPTION_KEY 未设置环境变量，使用默认密钥。生产环境请务必设置。');
            $encryptionWarningLogged = true;
        }
    }
    $key = hash('sha256', $rawKey, true);
    $iv = openssl_random_pseudo_bytes(16);
    $encrypted = openssl_encrypt($data, 'AES-256-CBC', $key, OPENSSL_RAW_DATA, $iv);
    if ($encrypted === false) {
        return 'raw:' . base64_encode($data);
    }
    return base64_encode($iv . $encrypted);
}

function decryptData($data) {
    if (strpos($data, 'raw:') === 0) {
        return base64_decode(substr($data, 4));
    }
    $rawKey = getenv('ENCRYPTION_KEY') ?: 'teacher_feedback_2024_secret_salt!';
    $key = hash('sha256', $rawKey, true);
    $decoded = base64_decode($data);
    if ($decoded === false || strlen($decoded) < 17) return '';
    $iv = substr($decoded, 0, 16);
    $encrypted = substr($decoded, 16);
    $decrypted = openssl_decrypt($encrypted, 'AES-256-CBC', $key, OPENSSL_RAW_DATA, $iv);
    return $decrypted !== false ? $decrypted : '';
}

// ============================================================
//  访问验证（已改为前端直接校验，此接口保留兼容）
// ============================================================
function verifyAccess() {
    echo json_encode([
        'success' => true,
        'message' => '验证码已改为前端直接校验',
    ], JSON_UNESCAPED_UNICODE);
}

// ============================================================
//  诊断接口
// ============================================================
function diagnose() {
    $info = [
        'php_version'    => PHP_VERSION,
        'curl_enabled'   => function_exists('curl_init'),
        'openssl_enabled'=> extension_loaded('openssl'),
        'sqlite_enabled' => extension_loaded('sqlite3'),
        'json_enabled'   => extension_loaded('json'),
        'mbstring_enabled'=> extension_loaded('mbstring'),
        'server'         => $_SERVER['SERVER_SOFTWARE'] ?? 'unknown',
        'os'             => PHP_OS . ' (' . php_uname('s') . ' ' . php_uname('r') . ')',
        'time'           => date('Y-m-d H:i:s'),
        'memory_limit'   => ini_get('memory_limit'),
        'max_execution_time' => ini_get('max_execution_time') . 's',
        'upload_max_filesize' => ini_get('upload_max_filesize'),
    ];

    // DNS 解析
    $dnsResult = @dns_get_record('dashscope.aliyuncs.com', DNS_A);
    $info['dns_resolve'] = $dnsResult ? 'OK (' . $dnsResult[0]['ip'] . ')' : 'FAILED';

    // TCP 连接
    $connTest = @fsockopen('dashscope.aliyuncs.com', 443, $errno, $errstr, 5);
    $info['tcp_connect_443'] = $connTest ? 'OK' : "FAILED: {$errstr} ({$errno})";
    if ($connTest) fclose($connTest);

    // API 配置
    $db = getDB();
    $config = $db->querySingle("SELECT model, is_active, created_at FROM api_config WHERE is_active = 1 ORDER BY id DESC LIMIT 1", true);
    $info['api_configured'] = $config ? 'YES (model: ' . $config['model'] . ', since: ' . $config['created_at'] . ')' : 'NO';
    $info['api_model'] = $config['model'] ?? '—';

    // curl 连通性测试
    $ch = curl_init('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 5,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
        CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => '{}',
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_NOBODY => true,
    ]);
    curl_exec($ch);
    $info['curl_test'] = curl_errno($ch) ? 'FAILED: ' . curl_error($ch) : 'OK (HTTP ' . curl_getinfo($ch, CURLINFO_HTTP_CODE) . ')';
    curl_close($ch);

    // 数据库状态
    try {
        $dbPath = DB_PATH;
        if (file_exists($dbPath)) {
            $info['db_status'] = 'OK';
            $info['db_size'] = round(filesize($dbPath) / 1024, 1) . ' KB';
        } else {
            $info['db_status'] = '文件不存在';
        }
        $countResult = $db->querySingle("SELECT COUNT(*) FROM feedback_history");
        $info['db_records'] = intval($countResult ?? 0);
        $studentResult = $db->querySingle("SELECT COUNT(DISTINCT student_name) FROM feedback_history WHERE student_name != ''");
        $info['db_students'] = intval($studentResult ?? 0);
    } catch (\Throwable $e) {
        $info['db_status'] = 'ERROR: ' . $e->getMessage();
    }

    // 文件权限
    $dataDir = dirname(DB_PATH);
    $info['data_dir_writable'] = is_dir($dataDir) ? is_writable($dataDir) : '目录不存在';

    echo json_encode(['success' => true, 'diagnose' => $info], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
}

// ============================================================
//  验证 API Key 有效性 & 获取模型列表
// ============================================================
function verifyApiKey() {
    $db = getDB();
    $config = $db->querySingle("SELECT * FROM api_config WHERE is_active = 1 ORDER BY id DESC LIMIT 1", true);

    if (!$config) {
        echo json_encode(['success' => false, 'message' => '未配置 API Key'], JSON_UNESCAPED_UNICODE);
        return;
    }

    $apiKey = decryptData($config['api_key']);
    if (empty($apiKey)) {
        echo json_encode(['success' => false, 'message' => 'API Key 解密失败'], JSON_UNESCAPED_UNICODE);
        return;
    }

    $keyLen = strlen($apiKey);
    $result = [
        'key_masked' => $keyLen > 8 ? (substr($apiKey, 0, 4) . '****' . substr($apiKey, -4)) : '****',
        'current_model' => $config['model'],
        'models_available' => [],
        'key_valid' => false,
    ];

    // 通过发送一个极短的请求来验证 Key 有效性
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL            => QWEN_API_URL,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode([
            'model'       => 'qwen-turbo',
            'messages'    => [['role' => 'user', 'content' => 'hi']],
            'max_tokens'  => 1,
            'temperature' => 0,
        ], JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json; charset=utf-8',
            'Authorization: Bearer ' . $apiKey,
        ],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTP_VERSION   => CURL_HTTP_VERSION_1_1,
    ]);

    $response  = curl_exec($ch);
    $httpCode  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($httpCode === 200) {
        $body = json_decode($response, true);
        if ($body && isset($body['choices'])) {
            $result['key_valid'] = true;
            $result['message'] = 'API Key 有效';
            // 提取 usage 信息（如果有）
            if (isset($body['usage'])) {
                $result['usage'] = $body['usage'];
            }
        }
    } elseif ($httpCode === 401 || $httpCode === 403) {
        $result['message'] = 'API Key 无效或已过期 (HTTP ' . $httpCode . ')';
    } elseif ($httpCode === 429) {
        $result['message'] = '请求过于频繁，请稍后重试 (HTTP 429)';
    } elseif ($httpCode === 400) {
        $body = json_decode($response, true);
        $result['message'] = '请求参数错误：' . ($body['message'] ?? '未知错误');
        // 400 也可能是 Key 格式不对
        $result['key_valid'] = false;
    } else {
        $result['message'] = $curlError ?: ('HTTP ' . $httpCode);
    }

    // 返回可用的模型列表（从配置）
    $result['models_available'] = AVAILABLE_MODELS;
    $result['http_code'] = $httpCode;

    echo json_encode(['success' => true, 'data' => $result], JSON_UNESCAPED_UNICODE);
}


// ============================================================
//  测试单个模型是否可用
// ============================================================
function testModel() {
    $model = trim($_GET['model'] ?? '');
    if (empty($model)) {
        echo json_encode(['success' => false, 'message' => '请指定模型名称 ?model=xxx'], JSON_UNESCAPED_UNICODE);
        return;
    }

    $db = getDB();
    $config = $db->querySingle("SELECT * FROM api_config WHERE is_active = 1 ORDER BY id DESC LIMIT 1", true);
    if (!$config) {
        echo json_encode(['success' => false, 'message' => '未配置 API Key'], JSON_UNESCAPED_UNICODE);
        return;
    }

    $apiKey = decryptData($config['api_key']);
    if (empty($apiKey)) {
        echo json_encode(['success' => false, 'message' => 'API Key 解密失败'], JSON_UNESCAPED_UNICODE);
        return;
    }

    $startTime = microtime(true);
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL            => QWEN_API_URL,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode([
            'model'       => $model,
            'messages'    => [['role' => 'user', 'content' => 'say hi']],
            'max_tokens'  => 5,
            'temperature' => 0,
        ], JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json; charset=utf-8',
            'Authorization: Bearer ' . $apiKey,
        ],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTP_VERSION   => CURL_HTTP_VERSION_1_1,
    ]);

    $response  = curl_exec($ch);
    $httpCode  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    $curlErrno = curl_errno($ch);
    $totalTime = round(microtime(true) - $startTime, 2);
    curl_close($ch);

    $result = [
        'model'       => $model,
        'http_code'   => $httpCode,
        'latency_ms'  => round($totalTime * 1000),
        'available'   => false,
        'message'     => '',
        'raw_error'   => '',
    ];

    if ($curlErrno) {
        $result['message'] = "网络错误：{$curlError} (errno: {$curlErrno})";
    } elseif ($httpCode === 200) {
        $body = json_decode($response, true);
        if ($body && isset($body['choices'])) {
            $result['available'] = true;
            $result['message'] = '模型可用';
            $result['response'] = $body['choices'][0]['message']['content'] ?? '';
            if (isset($body['usage'])) {
                $result['usage'] = $body['usage'];
            }
        } else {
            $result['message'] = '响应格式异常';
            $result['raw_error'] = mb_substr($response, 0, 300);
        }
    } elseif ($httpCode === 403) {
        $result['message'] = '403 禁止访问 — 此Key没有该模型的调用权限，请在百炼控制台开通';
        $body = json_decode($response, true);
        $result['raw_error'] = $body['message'] ?? $body['error']['message'] ?? $response;
    } elseif ($httpCode === 401) {
        $result['message'] = '401 未授权 — API Key无效或已过期';
    } elseif ($httpCode === 400) {
        $body = json_decode($response, true);
        $result['message'] = '400 参数错误 — 模型名称可能不被识别';
        $result['raw_error'] = $body['message'] ?? $body['error']['message'] ?? $response;
    } elseif ($httpCode === 429) {
        $result['message'] = '429 请求过多 — 请稍后重试';
    } else {
        $result['message'] = "HTTP {$httpCode} — 未知错误";
        $result['raw_error'] = mb_substr($response, 0, 300);
    }

    echo json_encode(['success' => true, 'data' => $result], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
}

// ============================================================
//  批量测试所有配置的模型
// ============================================================
function testAllModels() {
    $db = getDB();
    $config = $db->querySingle("SELECT * FROM api_config WHERE is_active = 1 ORDER BY id DESC LIMIT 1", true);
    if (!$config) {
        echo json_encode(['success' => false, 'message' => '未配置 API Key'], JSON_UNESCAPED_UNICODE);
        return;
    }

    $apiKey = decryptData($config['api_key']);
    if (empty($apiKey)) {
        echo json_encode(['success' => false, 'message' => 'API Key 解密失败'], JSON_UNESCAPED_UNICODE);
        return;
    }

    $currentModel = $config['model'];
    $results = [];
    
    // 对每个模型发送一个极短请求测试可用性
    foreach (AVAILABLE_MODELS as $modelKey => $modelLabel) {
        $startTime = microtime(true);
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL            => QWEN_API_URL,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => json_encode([
                'model'       => $modelKey,
                'messages'    => [['role' => 'user', 'content' => 'say hi']],
                'max_tokens'  => 3,
                'temperature' => 0,
            ], JSON_UNESCAPED_UNICODE),
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json; charset=utf-8',
                'Authorization: Bearer ' . $apiKey,
            ],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 15,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HTTP_VERSION   => CURL_HTTP_VERSION_1_1,
        ]);

        $response  = curl_exec($ch);
        $httpCode  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        $totalTime = round(microtime(true) - $startTime, 2);
        curl_close($ch);

        $status = 'unknown';
        $detail = '';
        if ($httpCode === 200) {
            $body = json_decode($response, true);
            if ($body && isset($body['choices'])) {
                $status = 'ok';
                $detail = $body['choices'][0]['message']['content'] ?? '';
            } else {
                $status = 'format_error';
                $detail = '响应格式异常';
            }
        } elseif ($httpCode === 403) {
            $status = 'forbidden';
            $detail = '无权限（需开通）';
        } elseif ($httpCode === 401) {
            $status = 'unauthorized';
            $detail = 'Key无效';
        } elseif ($httpCode === 400) {
            $status = 'bad_request';
            $body = json_decode($response, true);
            $detail = $body['message'] ?? $body['error']['message'] ?? '模型名不识别';
        } elseif ($httpCode === 404) {
            $status = 'not_found';
            $detail = '模型不存在';
        } elseif ($httpCode === 429) {
            $status = 'rate_limited';
            $detail = '频率限制';
        } else {
            $status = 'error';
            $detail = $curlError ?: "HTTP {$httpCode}";
        }

        $results[] = [
            'model'      => $modelKey,
            'label'      => $modelLabel,
            'is_current' => $modelKey === $currentModel,
            'status'     => $status,
            'detail'     => $detail,
            'http_code'  => $httpCode,
            'latency_ms' => round($totalTime * 1000),
        ];

        // 避免请求过快
        usleep(200000); // 200ms间隔
    }

    // 统计
    $okCount = count(array_filter($results, fn($r) => $r['status'] === 'ok'));
    $forbiddenCount = count(array_filter($results, fn($r) => $r['status'] === 'forbidden'));
    $totalCount = count($results);

    // ============ 持久化检测结果 ============
    // 保存到 system_config，页面刷新后仍可读取
    $checkResult = [
        'current_model' => $currentModel,
        'total'         => $totalCount,
        'available'     => $okCount,
        'forbidden'     => $forbiddenCount,
        'checked_at'    => date('Y-m-d H:i:s'),
    ];
    $db->exec("INSERT OR REPLACE INTO system_config (config_key, config_value, description, created_at, updated_at) 
        VALUES ('model_check_result', '" . $db->escapeString(json_encode($checkResult, JSON_UNESCAPED_UNICODE)) . "', '最新模型检测结果', '" . date('Y-m-d H:i:s') . "', '" . date('Y-m-d H:i:s') . "')");

    echo json_encode([
        'success' => true,
        'data' => [
            'current_model' => $currentModel,
            'total'         => $totalCount,
            'available'     => $okCount,
            'forbidden'     => $forbiddenCount,
            'results'       => $results,
            'checked_at'    => $checkResult['checked_at'],
        ]
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
}

// ============================================================
//  数据导出（CSV/JSON格式）
// ============================================================
function exportData() {
    $format = strtolower($_GET['format'] ?? 'csv');
    $studentFilter = trim($_GET['student'] ?? '');
    
    $db = getDB();
    $whereClause = '';
    $params = [];
    
    if ($studentFilter !== '') {
        $whereClause = "WHERE student_name = :student";
        $params[':student'] = $studentFilter;
    }
    
    $stmt = $db->prepare("SELECT * FROM feedback_history {$whereClause} ORDER BY id DESC");
    foreach ($params as $key => $val) {
        $stmt->bindValue($key, $val, SQLITE3_TEXT);
    }
    $results = $stmt->execute();
    
    $records = [];
    while ($row = $results->fetchArray(SQLITE3_ASSOC)) {
        $records[] = $row;
    }
    
    $timestamp = date('Y-m-d_His');
    
    if ($format === 'csv') {
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="学生反馈数据_' . $timestamp . '.csv"');
        header('Cache-Control: no-cache');
        
        // 添加BOM以支持Excel正确识别UTF-8中文
        echo "\xEF\xBB\xBF";
        
        $output = fopen('php://output', 'w');
        
        // CSV表头
        $headers = ['ID', '学生姓名', '水平等级', '作业完成情况', '听课状态', '课堂互动', '犯困情况', 
                    '溜号情况', '随堂练习', '基础知识', '做题技巧', '解题思路', '计算能力', 
                    '学习习惯', '进步趋势', '数学思维', '教学场景', '授课内容', '布置作业', 
                    '补充说明', '生成反馈', '使用模型', '输入Token', '输出Token', '总Token', '创建时间'];
        fputcsv($output, $headers);
        
        foreach ($records as $r) {
            $row = [
                $r['id'] ?? '',
                $r['student_name'] ?? '',
                $r['student_level'] ?? '',
                $r['homework_status'] ?? '',
                $r['attention_status'] ?? '',
                $r['interaction_status'] ?? '',
                $r['drowsy_status'] ?? '',
                $r['daydream_status'] ?? '',
                $r['exercise_status'] ?? '',
                $r['basic_knowledge'] ?? '',
                $r['skill_speed'] ?? '',
                $r['analysis_ability'] ?? '',
                $r['calculation_ability'] ?? '',
                $r['study_habit'] ?? '',
                $r['progress_trend'] ?? '',
                $r['math_thinking'] ?? '',
                $r['teaching_scene'] ?? '',
                $r['teaching_content'] ?? '',
                $r['homework_assign'] ?? '',
                $r['custom_note'] ?? '',
                $r['generated_feedback'] ?? '',
                $r['model_used'] ?? '',
                $r['prompt_tokens'] ?? 0,
                $r['completion_tokens'] ?? 0,
                $r['total_tokens'] ?? 0,
                $r['created_at'] ?? '',
            ];
            fputcsv($output, $row);
        }
        fclose($output);
        exit;
    }
    
    // JSON格式
    header('Content-Type: application/json; charset=utf-8');
    header('Content-Disposition: attachment; filename="学生反馈数据_' . $timestamp . '.json"');
    header('Cache-Control: no-cache');
    echo json_encode([
        'export_time' => date('Y-m-d H:i:s'),
        'total_records' => count($records),
        'records' => $records,
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

// ============================================================
//  Token统计：累计消耗 + 按模型分组 + 最近记录
// ============================================================
function getTokenStats() {
    $db = getDB();

    // 总计
    $totals = $db->querySingle("
        SELECT 
            COUNT(*) as total_generations,
            COALESCE(SUM(prompt_tokens), 0) as total_prompt,
            COALESCE(SUM(completion_tokens), 0) as total_completion,
            COALESCE(SUM(total_tokens), 0) as total_all
        FROM feedback_history
    ", true);

    // 按模型分组
    $byModel = $db->query("
        SELECT 
            model_used,
            COUNT(*) as count,
            COALESCE(SUM(prompt_tokens), 0) as total_prompt,
            COALESCE(SUM(completion_tokens), 0) as total_completion,
            COALESCE(SUM(total_tokens), 0) as total_all
        FROM feedback_history 
        GROUP BY model_used
        ORDER BY total_all DESC
    ");

    $modelStats = [];
    while ($row = $byModel->fetchArray(SQLITE3_ASSOC)) {
        $modelStats[] = $row;
    }

    // 最近10次生成的token详情
    $recent = $db->query("
        SELECT id, student_name, model_used, prompt_tokens, completion_tokens, total_tokens, created_at
        FROM feedback_history 
        ORDER BY id DESC 
        LIMIT 10
    ");

    $recentItems = [];
    while ($row = $recent->fetchArray(SQLITE3_ASSOC)) {
        $recentItems[] = $row;
    }

    echo json_encode([
        'success' => true,
        'data' => [
            'totals' => $totals,
            'by_model' => $modelStats,
            'recent' => $recentItems,
        ]
    ], JSON_UNESCAPED_UNICODE);
}

// ============================================================
//  查询千问账户配额/余额信息
// ============================================================
function getQuotaInfo() {
    $db = getDB();
    $config = $db->querySingle("SELECT * FROM api_config WHERE is_active = 1 ORDER BY id DESC LIMIT 1", true);

    if (!$config) {
        echo json_encode(['success' => false, 'message' => '未配置 API Key'], JSON_UNESCAPED_UNICODE);
        return;
    }

    $apiKey = decryptData($config['api_key']);
    if (empty($apiKey)) {
        echo json_encode(['success' => false, 'message' => 'API Key 解密失败'], JSON_UNESCAPED_UNICODE);
        return;
    }

    // 千问没有直接的余额/配额查询接口，通过 Dashboard API 尝试获取
    // 方案1：使用 dashscope 的 usage 查询接口
    $result = [
        'quota' => null,
        'message' => '',
        'source' => '',
    ];

    // 尝试通过 dashscope console API 获取用户信息（部分Key支持）
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL            => 'https://dashscope.aliyuncs.com/api/v1/usage/statistics?time_range=30d',
        CURLOPT_HTTPHEADER     => [
            'Authorization: Bearer ' . $apiKey,
            'Content-Type: application/json',
        ],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode === 200) {
        $data = json_decode($response, true);
        if ($data && isset($data['data'])) {
            $result['quota'] = $data['data'];
            $result['source'] = 'dashscope_usage_api';
            $result['message'] = '已获取近30天用量统计';
        }
    }

    // 如果上面的接口不可用，尝试获取模型列表来验证Key并给出建议
    if ($result['quota'] === null) {
        $result['message'] = '千问API不支持直接查询余额/配额。\n建议登录阿里云百炼控制台查看：\nhttps://dashscope.console.aliyun.com/overview';
        $result['source'] = 'manual';

        // 至少获取本地统计信息
        $localStats = $db->querySingle("
            SELECT 
                COUNT(*) as total_generations,
                COALESCE(SUM(total_tokens), 0) as total_tokens
            FROM feedback_history
        ", true);
        $result['local_usage'] = $localStats;
    }

    echo json_encode(['success' => true, 'data' => $result], JSON_UNESCAPED_UNICODE);
}
