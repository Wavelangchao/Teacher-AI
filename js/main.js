// ============ 全局状态变量 ============
    let selectedDimensions = {};   // 用户选择的维度 { dimId: value | [values] }
    let currentFeedback = '';     // 当前生成的反馈内容
    let streamAbortController = null; // SSE 流的中止控制器
    let streamModelName = '';     // 流式生成使用的实际模型名
    let selectModeActive = false; // 历史记录批量选择模式
    let selectedHistoryIds = new Set(); // 选中的历史记录ID集合
    let historyPage = 1;          // 历史记录当前页码
    let historyTotalPages = 1;    // 历史记录总页数
    let historySearchTerm = '';   // 历史记录搜索关键词
    let historyStudentFilter = ''; // 按学生姓名筛选
    let historyFromProfile = '';  // 记录是否从学生档案进入，存储学生姓名
    let multiStudentList = [];    // 小班课模式：学生列表 [{name, level, dims:{}}]
    let isMultiStudentMode = false; // 是否处于小班课多学生模式

    // ============ Picker（点击式选择面板） ============
    function togglePicker(id) {
        const wrap = document.getElementById('picker-' + id);
        if (!wrap) return;
        const isOpen = wrap.classList.contains('active');
        // 先移除旧的监听器，防止残留
        document.removeEventListener('click', pickerOutsideClick);
        closeAllPickers();
        if (!isOpen) {
            wrap.classList.add('active');
            // 延迟绑定，避免当前点击事件立即触发关闭
            setTimeout(() => {
                document.addEventListener('click', pickerOutsideClick);
            }, 0);
        }
    }

    function selectPicker(id, value, label) {
        const wrap = document.getElementById('picker-' + id);
        const hiddenInput = document.getElementById(id);
        if (!wrap || !hiddenInput) return;
        
        // 更新隐藏input的值（保持兼容原有.value读取方式）
        hiddenInput.value = value;
        
        // 更新按钮文字
        const btnText = wrap.querySelector('.picker-btn-text');
        if (btnText) {
            btnText.textContent = label;
            btnText.classList.toggle('placeholder', !value);
        }
        
        // 标记选中项（兼容 .picker-item 和 .grade-item）
        const items = wrap.querySelectorAll('.picker-item, .grade-item');
        items.forEach(item => {
            item.classList.toggle('selected', item.dataset.value === value);
        });
        
        // 关闭面板
        wrap.classList.remove('active');
        document.removeEventListener('click', pickerOutsideClick);

        // 教学场景切换：小班课/大班课 → 多学生模式
        if (id === 'teachingScene') {
            // 延迟执行，等待picker面板关闭动画完成，避免DOM突变导致页面跳动
            setTimeout(() => {
                toggleMultiStudentMode(value === 'small_group' || value === 'large_group');
            }, 50);
        }
    }

    function closeAllPickers() {
        document.querySelectorAll('.picker-wrap.active').forEach(w => w.classList.remove('active'));
        document.removeEventListener('click', pickerOutsideClick);
    }

    // 年级面板 Tab 切换
    function switchGradeTab(grade, btn) {
        const panel = document.getElementById('picker-studentGrade');
        if (!panel) return;
        // 切换 Tab 激活态
        panel.querySelectorAll('.grade-tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        // 切换面板
        panel.querySelectorAll('.grade-panel').forEach(p => p.classList.remove('active'));
        const target = panel.querySelector('.grade-panel[data-grade="' + grade + '"]');
        if (target) target.classList.add('active');
    }

    function pickerOutsideClick(e) {
        // 如果点击的不是picker内部元素，关闭所有picker
        if (!e.target.closest('.picker-wrap')) {
            closeAllPickers();
        }
    }

    // ============ 快速模板 ============
    // 带确认的安全模板应用（如果已有维度选择则弹窗确认）
    function applyTemplateSafe(type) {
        const hasSelection = Object.keys(selectedDimensions).length > 0;
        if (hasSelection) {
            const names = { excellent: '「表现优异」', average: '「表现中等」', weak: '「需要加强」', quick: '「快速填写」' };
            if (!confirm('当前已选择了 ' + Object.keys(selectedDimensions).length + ' 个评价维度。\n\n点击模板 ' + (names[type] || type) + ' 将覆盖所有已选维度，确定继续吗？')) {
                return;
            }
        }
        applyTemplate(type);
    }

    function applyTemplate(type) {
        // 先清空所有维度选择
        Object.keys(selectedDimensions).forEach(k => delete selectedDimensions[k]);
        document.querySelectorAll('.dim-option.active').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.dimension-item.selected').forEach(el => el.classList.remove('selected'));

        const templates = {
            excellent: {
                homework_status: '作业全部完成，正确率高，书写工整，态度认真',
                attention_status: '上课全程专注，思维活跃，能紧跟老师节奏并主动思考',
                exercise_status: '随堂练习全部正确完成，解题过程规范，掌握很扎实',
                basic_knowledge: '基础知识扎实，概念理解透彻，能灵活运用',
                calculation_ability: '计算能力出色，准确率高，步骤规范',
                analysis_ability: '解题思路清晰严谨，能独立分析并解决较难题目',
                progress_trend: '比上节课有明显进步，之前薄弱的知识点有明显改善',
            },
            average: {
                homework_status: '作业全部完成，但存在少量错误，整体尚可',
                attention_status: '听课状态良好，注意力集中，能跟上课堂进度',
                exercise_status: '大部分题目做对了，个别有误但能理解错因',
                basic_knowledge: '基础概念知道，但灵活运用能力不足',
                calculation_ability: '计算基本过关，偶尔出现马虎性错误',
            },
            weak: {
                homework_status: '作业不会做，相关知识点没有掌握',
                attention_status: '注意力不够集中，容易被周围事物干扰，需要多次提醒',
                exercise_status: '正确率偏低，存在较多错误，需要加强同类练习',
                basic_knowledge: '基础知识存在明显薄弱环节，公式/定理记忆不牢',
                calculation_ability: '计算基础薄弱，基本运算也容易出错',
                study_habit: '遇到不会的题目不愿意多思考，容易放弃',
            },
            quick: {
                homework_status: '作业全部完成，但存在少量错误，整体尚可',
                attention_status: '听课状态良好，注意力集中，能跟上课堂进度',
            },
        };

        const selections = templates[type];
        if (!selections) return;

        let appliedCount = 0;
        Object.entries(selections).forEach(([dimId, value]) => {
            selectedDimensions[dimId] = value;
            // 激活对应的选项
            const container = document.getElementById('dim-' + dimId);
            if (container) {
                container.classList.add('selected');
                const optionEl = container.querySelector(`.dim-option[data-value="${escapeHtml(value)}"]`);
                if (optionEl) {
                    optionEl.classList.add('active');
                    appliedCount++;
                }
            }
        });

        const names = { excellent: '「表现优异」', average: '「表现中等」', weak: '「需要加强」', quick: '「快速填写」' };
        const totalTemplates = Object.keys(selections).length;
        const countMsg = appliedCount === totalTemplates ? '' : `（${appliedCount}/${totalTemplates}项匹配成功）`;
        showToast('已应用模板：' + (names[type] || type) + ' ' + countMsg, 'success');
        updateDimensionStats(); // 更新选择统计
    }

    function clearAllDimensions() {
        Object.keys(selectedDimensions).forEach(k => delete selectedDimensions[k]);
        document.querySelectorAll('.dim-option.active').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.dimension-item.selected').forEach(el => el.classList.remove('selected'));
        updateDimensionStats();
        showToast('所有维度已重置', 'info');
    }

    // ============ 多学生管理（小班课/大班课） ============
    // 当前教学场景标识（small_group / large_group）
    let currentMultiScene = '';
    // 保存进入多人模式前的字数设置，退出时恢复
    let savedWordCountRange = '';
    
    // 根据学生数量推荐字数范围
    function recommendWordCountRange() {
        const count = multiStudentList.length;
        const select = document.getElementById('wordCountRange');
        const hint = document.getElementById('wordCountHint');
        if (!select) return;
        
        // 每学生80-150字 + 授课内容/作业等固定部分约100-200字
        if (count <= 1) {
            select.value = savedWordCountRange || '200-400';
            if (hint) hint.style.display = 'none';
        } else if (count <= 2) {
            select.value = '350-550';
            if (hint) { hint.textContent = '（约175-275字/生）'; hint.style.display = 'inline'; }
        } else if (count <= 4) {
            select.value = '500-800';
            if (hint) { hint.textContent = '（约125-200字/生）'; hint.style.display = 'inline'; }
        } else {
            select.value = '500-800';
            if (hint) { hint.textContent = '（约100-160字/生）'; hint.style.display = 'inline'; }
        }
    }
    
    // 切换多学生模式
    function toggleMultiStudentMode(enabled) {
        const singleGroup = document.getElementById('singleStudentGroup');
        const multiGroup = document.getElementById('multiStudentGroup');
        const dimGridWrapper = document.getElementById('dimensionGridWrapper');
        const gradeRow = document.getElementById('studentGradeRow');
        const sceneValue = document.getElementById('teachingScene').value;
        isMultiStudentMode = enabled;
        currentMultiScene = enabled ? sceneValue : '';
        
        if (enabled) {
            // 保存当前字数设置
            const wcSelect = document.getElementById('wordCountRange');
            if (wcSelect) savedWordCountRange = wcSelect.value;
            
            // 切换到多学生模式
            if (singleGroup) singleGroup.classList.add('hidden');
            if (multiGroup) multiGroup.classList.remove('hidden');
            
            // 更新多学生区域的标签文案
            const sceneLabel = sceneValue === 'large_group' ? '大班课' : '小班课';
            const multiLabel = multiGroup ? multiGroup.querySelector('.form-label') : null;
            if (multiLabel) {
                multiLabel.innerHTML = '👥 学生列表 <span class="required">*</span> <span class="hint">（' + sceneLabel + '模式，逐一填写每位学生）</span>';
            }
            
            // 年级选择器始终可见（已独立于singleStudentGroup之外）
            if (gradeRow) gradeRow.classList.remove('hidden');
            // 隐藏全局维度选择区及标题（多学生模式每位学生独立选择）
            if (dimGridWrapper) {
                dimGridWrapper.style.display = 'none';
                const dimLabel = dimGridWrapper.previousElementSibling;
                if (dimLabel) dimLabel.style.display = 'none';
            }
            // 如果还没有学生，默认添加一个空卡
            if (multiStudentList.length === 0) {
                addStudentCard();
            }
            // 隐藏快速模板区域
            updateTemplateVisibility(false);
            
            // 根据学生数量推荐字数
            recommendWordCountRange();
            
            // 滚动到多学生区域，避免跳到底部
            requestAnimationFrame(() => {
                if (multiGroup) {
                    multiGroup.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            });
        } else {
            // 切换回一对一模式
            if (singleGroup) singleGroup.classList.remove('hidden');
            if (multiGroup) multiGroup.classList.add('hidden');
            if (gradeRow) gradeRow.classList.remove('hidden');
            // 恢复全局维度选择区
            if (dimGridWrapper) {
                dimGridWrapper.style.display = '';
                const dimLabel = dimGridWrapper.previousElementSibling;
                if (dimLabel) dimLabel.style.display = '';
            }
            updateTemplateVisibility(true);
            // 恢复之前的字数设置
            if (savedWordCountRange) {
                const wcSelect = document.getElementById('wordCountRange');
                if (wcSelect) wcSelect.value = savedWordCountRange;
            }
            // 隐藏字数提示
            const hint = document.getElementById('wordCountHint');
            if (hint) hint.style.display = 'none';
        }
    }

    // 小班课模式下隐藏/显示快速模板
    function updateTemplateVisibility(visible) {
        const templateSection = document.querySelector('.template-section');
        if (templateSection) {
            templateSection.style.display = visible ? '' : 'none';
        }
    }

    // 添加学生卡片
    function addStudentCard() {
        multiStudentList.push({ name: '', level: '', dims: {} });
        renderStudentCards();
        // 根据学生数量推荐字数
        recommendWordCountRange();
        // 滚动到最后一个学生卡片（但不强制到底部）
        requestAnimationFrame(() => {
            const lastCard = document.querySelector('#studentList .student-card:last-child');
            if (lastCard) {
                lastCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });
    }

    // 删除学生卡片
    function removeStudentCard(index) {
        if (multiStudentList.length <= 1) {
            showToast('至少保留一位学生', 'info');
            return;
        }
        multiStudentList.splice(index, 1);
        renderStudentCards();
        // 根据剩余学生数量推荐字数
        recommendWordCountRange();
    }

    // 更新学生姓名
    function updateStudentName(index, name) {
        if (multiStudentList[index]) {
            multiStudentList[index].name = name;
        }
    }

    // 更新学生水平等级
    function updateStudentLevel(index, level) {
        if (multiStudentList[index]) {
            multiStudentList[index].level = level;
        }
    }

    // 切换学生维度的展开/折叠
    function toggleStudentDims(index) {
        const panel = document.getElementById('student-dims-panel-' + index);
        const toggle = document.getElementById('student-dims-toggle-' + index);
        if (!panel) return;
        const isOpen = panel.classList.contains('open');
        if (isOpen) {
            panel.classList.remove('open');
            if (toggle) toggle.innerHTML = '📊 展开评价维度 <span class="dims-toggle-arrow">▸</span>';
        } else {
            panel.classList.add('open');
            if (toggle) toggle.innerHTML = '📊 收起评价维度 <span class="dims-toggle-arrow open">▾</span>';
        }
    }

    // 学生维度选择（点击chip）
    function selectStudentDim(index, dimId, value, el) {
        const student = multiStudentList[index];
        if (!student) return;
        if (!student.dims) student.dims = {};

        // 安全解码：HTML属性中可能使用了 &#39; 转义
        const safeValue = value.replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');

        // 找到该维度的定义
        const dimDef = DIMENSIONS.find(d => d.id === dimId);
        const isMulti = dimDef ? dimDef.multi : false;

        if (isMulti) {
            // 多选模式
            const wasActive = el.classList.contains('active');
            if (wasActive) {
                el.classList.remove('active');
                if (student.dims[dimId]) {
                    student.dims[dimId] = student.dims[dimId].filter(v => v !== safeValue);
                    if (student.dims[dimId].length === 0) delete student.dims[dimId];
                }
            } else {
                el.classList.add('active');
                if (!student.dims[dimId]) student.dims[dimId] = [];
                if (!student.dims[dimId].includes(safeValue)) {
                    student.dims[dimId].push(safeValue);
                }
            }
        } else {
            // 单选模式：先清除同维度的active
            const panel = document.getElementById('student-dims-panel-' + index);
            if (panel) {
                panel.querySelectorAll('.student-dim-chip[data-dim="' + dimId + '"]').forEach(chip => {
                    chip.classList.remove('active');
                });
            }
            const wasActive = el.classList.contains('active');
            if (!wasActive) {
                el.classList.add('active');
                student.dims[dimId] = safeValue;
            } else {
                delete student.dims[dimId];
            }
        }
    }

    // 渲染学生卡片列表
    function renderStudentCards() {
        const list = document.getElementById('studentList');
        if (!list) return;

        // 保存当前展开/折叠状态（按 index 记录面板 + 分类折叠）
        const openStates = {};
        const catOpenStates = {}; // 分类折叠状态 { "studentIndex-catIndex": true/false }
        list.querySelectorAll('.student-dims-panel').forEach(panel => {
            const idMatch = panel.id.match(/^student-dims-panel-(\d+)$/);
            if (idMatch) {
                const idx = parseInt(idMatch[1]);
                openStates[idx] = panel.classList.contains('open');
                // 保存分类折叠状态
                panel.querySelectorAll('.student-dim-category').forEach(cat => {
                    const header = cat.querySelector('.student-dim-cat-header');
                    const body = cat.querySelector('.student-dim-cat-body');
                    if (header && body) {
                        const catData = header.getAttribute('data-cat');
                        catOpenStates[catData] = body.classList.contains('open');
                    }
                });
            }
        });

        const levelOptions = [
            { value: '', label: '水平等级（选填）' },
            { value: '优秀', label: '优秀 🌟' },
            { value: '良好', label: '良好 👍' },
            { value: '中等', label: '中等 😐' },
            { value: '薄弱', label: '薄弱 ⚠️' },
        ];

        list.innerHTML = multiStudentList.map((student, index) => {
            const dimCount = student.dims ? Object.keys(student.dims).length : 0;
            const dimBadge = dimCount > 0 ? ` <span class="student-dims-toggle-badge">${dimCount}项已选</span>` : '';
            // 恢复之前的展开状态
            const isPanelOpen = openStates[index] || false;

            return `
            <div class="student-card">
                <div class="student-card-header">
                    <span class="student-card-number">${index + 1}</span>
                    <input type="text" class="student-card-name-input" 
                           placeholder="请输入学生姓名" 
                           value="${escapeHtml(student.name)}"
                           oninput="updateStudentName(${index}, this.value)">
                    <button class="student-card-remove" onclick="removeStudentCard(${index})" title="移除该学生">✕</button>
                </div>
                <div class="student-card-body">
                    <select class="student-card-level-select" 
                            onchange="updateStudentLevel(${index}, this.value)">
                        ${levelOptions.map(opt => `
                            <option value="${opt.value}" ${student.level === opt.value ? 'selected' : ''}>${opt.label}</option>
                        `).join('')}
                    </select>
                </div>
                <div class="student-dims-toggle" id="student-dims-toggle-${index}" 
                      onclick="toggleStudentDims(${index})">
                    📊 ${isPanelOpen ? '收起' : '展开'}评价维度 <span class="dims-toggle-arrow${isPanelOpen ? ' open' : ''}">${isPanelOpen ? '▾' : '▸'}</span>${dimBadge}
                </div>
                <div class="student-dims-panel${isPanelOpen ? ' open' : ''}" id="student-dims-panel-${index}">
                    ${renderStudentDimGrid(index, student, catOpenStates)}
                </div>
            </div>`;
        }).join('');
    }

    // 渲染单个学生的维度选择网格（折叠式，优化长列表显示）
    function renderStudentDimGrid(index, student, catOpenStates) {
        catOpenStates = catOpenStates || {};
        // 将维度按分类分组，每个分类可折叠
        const categories = [
            { title: '📋 课堂表现', dims: ['homework_status', 'attention_status', 'interaction_status', 'drowsy_status', 'daydream_status'] },
            { title: '📝 练习与基础', dims: ['exercise_status', 'basic_knowledge', 'calculation_ability'] },
            { title: '🧠 能力与习惯', dims: ['skill_speed', 'analysis_ability', 'study_habit', 'progress_trend', 'math_thinking'] },
        ];
        
        const studentDims = student.dims || {};
        
        return categories.map((cat, catIdx) => {
            const catDims = cat.dims.map(dimId => DIMENSIONS.find(d => d.id === dimId)).filter(Boolean);
            if (catDims.length === 0) return '';
            
            // 统计该分类已选维度数
            const catSelectedCount = catDims.filter(d => !!studentDims[d.id]).length;
            const catBadge = catSelectedCount > 0 ? ` <span class="student-dim-cat-badge">${catSelectedCount}</span>` : '';
            const catKey = index + '-' + catIdx;
            const isCatOpen = catOpenStates[catKey] !== undefined ? catOpenStates[catKey] : false;
            
            return `
            <div class="student-dim-category">
                <div class="student-dim-cat-header" onclick="toggleStudentDimCategory(this)" data-cat="${catKey}">
                    <span>${cat.title}${catBadge}</span>
                    <span class="student-dim-cat-arrow">${isCatOpen ? '▾' : '▸'}</span>
                </div>
                <div class="student-dim-cat-body${isCatOpen ? ' open' : ''}">
                    ${catDims.map(dim => {
                        const multiHint = dim.multi ? '<span class="student-dim-type student-dim-type-multi">多选</span>' : '<span class="student-dim-type student-dim-type-single">单选</span>';
                        const requiredHint = dim.required === false ? '<span class="student-dim-type student-dim-type-optional">选填</span>' : '';
                        const dimSelectedCount = studentDims[dim.id] ? (Array.isArray(studentDims[dim.id]) ? studentDims[dim.id].length : 1) : 0;
                        const dimDot = dimSelectedCount > 0 ? ` <span class="student-dim-dot" title="已选${dimSelectedCount}项">●</span>` : '';
                        
                        const chips = dim.options.map(opt => {
                            let isActive = false;
                            if (studentDims[dim.id]) {
                                if (Array.isArray(studentDims[dim.id])) {
                                    isActive = studentDims[dim.id].includes(opt.value);
                                } else {
                                    isActive = (studentDims[dim.id] === opt.value);
                                }
                            }
                            return `<span class="student-dim-chip${isActive ? ' active' : ''}" 
                                          data-dim="${dim.id}" 
                                          data-value="${escapeHtml(opt.value)}"
                                          onclick="selectStudentDim(${index}, '${dim.id}', '${escapeHtml(opt.value)}', this)">
                                    ${opt.label}
                                </span>`;
                        }).join('');
                        
                        return `
                        <div class="student-dim-row">
                            <div class="student-dim-row-title">
                                ${dim.icon} ${dim.title}${dimDot} ${multiHint}${requiredHint}
                            </div>
                            <div class="student-dim-grid">${chips}</div>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        }).join('');
    }
    
    // 切换维度分类折叠
    function toggleStudentDimCategory(headerEl) {
        const body = headerEl.nextElementSibling;
        const arrow = headerEl.querySelector('.student-dim-cat-arrow');
        if (!body) return;
        const isOpen = body.classList.contains('open');
        if (isOpen) {
            body.classList.remove('open');
            if (arrow) arrow.textContent = '▸';
        } else {
            body.classList.add('open');
            if (arrow) arrow.textContent = '▾';
        }
    }

    // 更新维度选择统计（显示在模板区域）
    function updateDimensionStats() {
        const count = Object.keys(selectedDimensions).length;
        const statsEl = document.getElementById('dimensionStats');
        if (statsEl) {
            if (count > 0) {
                statsEl.textContent = '（已选 ' + count + ' 个维度）';
                statsEl.style.display = '';
            } else {
                statsEl.style.display = 'none';
            }
        }
    }

    // ============ 强制刷新：清理缓存并重新加载 ============
    function forceRefresh() {
        // 清除 localStorage 中所有应用相关数据（但保留 API Key 和用户配置）
        const keepKeys = ['api_key', 'model', 'temperature', 'max_tokens'];
        const preserved = {};
        keepKeys.forEach(k => {
            const val = localStorage.getItem(k);
            if (val !== null) preserved[k] = val;
        });
        
        // 清除所有 localStorage
        localStorage.clear();
        
        // 恢复用户配置
        Object.entries(preserved).forEach(([k, v]) => localStorage.setItem(k, v));
        
        // 清除 sessionStorage（确保访问验证状态也被重置）
        sessionStorage.clear();
        
        // 清除所有 Cookie 中的缓存标记
        document.cookie.split(';').forEach(c => {
            const eqPos = c.indexOf('=');
            const name = eqPos > -1 ? c.substr(0, eqPos).trim() : c.trim();
            if (name) {
                document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
            }
        });
        
        // 清除 Service Worker 缓存
        if ('caches' in window) {
            caches.keys().then(names => {
                return Promise.all(names.map(name => caches.delete(name)));
            }).catch(() => {});
        }
        
        // 注销所有 Service Worker（如果有注册过的话）
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(registrations => {
                registrations.forEach(reg => reg.unregister());
            }).catch(() => {});
        }
        
        showToast('正在清理缓存并刷新...', 'info');
        
        // 用时间戳参数绕过浏览器缓存，强制请求最新版本
        // 移动端 location.reload(true) 支持很差，用带参数跳转替代
        setTimeout(() => {
            const url = new URL(window.location.href);
            // 添加/更新 _t 时间戳参数，绕过所有层级的缓存
            url.searchParams.set('_t', Date.now());
            // 使用 location.replace 替换当前历史记录，防止用户后退到旧版本
            window.location.replace(url.toString());
        }, 500);
    }

    // ============ 日期选择器初始化 ============
    const daysInMonth = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

    function initDateSelectors() {
        const monthSel = document.getElementById('feedbackMonth');
        const daySel = document.getElementById('feedbackDay');

        // 填充月份 1-12
        for (let m = 1; m <= 12; m++) {
            monthSel.innerHTML += `<option value="${m}">${m}</option>`;
        }

        // 月份变化时联动更新日期
        monthSel.addEventListener('change', () => {
            const m = parseInt(monthSel.value) || 0;
            const maxD = daysInMonth[m] || 31;
            const oldDay = daySel.value;
            daySel.innerHTML = '<option value="">日</option>';
            for (let d = 1; d <= maxD; d++) {
                const sel = (d === parseInt(oldDay) && d <= maxD) ? ' selected' : '';
                daySel.innerHTML += `<option value="${d}"${sel}>${d}</option>`;
            }
            if (parseInt(oldDay) > maxD) daySel.value = '';
        });

        // 初始化当天日期
        const now = new Date();
        monthSel.value = now.getMonth() + 1;
        monthSel.dispatchEvent(new Event('change'));
        daySel.value = now.getDate();
    }

    // 获取当前选中的日期（月.日格式）
    function getFeedbackDate() {
        const m = document.getElementById('feedbackMonth').value;
        const d = document.getElementById('feedbackDay').value;
        if (m && d) return m + '.' + d;
        return '';
    }

    // 设置日期选择器
    function setFeedbackDate(month, day) {
        const monthSel = document.getElementById('feedbackMonth');
        monthSel.value = month;
        monthSel.dispatchEvent(new Event('change'));
        document.getElementById('feedbackDay').value = day;
    }

    // ============ 重置表单，准备生成下一个学生的反馈 ============
    function resetForNextStudent() {
        // 如果在多学生模式下，清空学生列表并重置
        if (isMultiStudentMode) {
            multiStudentList = [];
            renderStudentCards();
            // 默认添加一个空卡
            addStudentCard();
        }
        
        // 清空维度选择
        clearAllDimensions();
        // 清空学生姓名（一对一模式）
        const nameInput = document.getElementById('studentName');
        if (nameInput) nameInput.value = '';
        // 日期自动+1天（纯月.日格式，不涉及年份）
        const monthSel = document.getElementById('feedbackMonth');
        const daySel = document.getElementById('feedbackDay');
        const m = parseInt(monthSel.value);
        const d = parseInt(daySel.value);
        if (m && d) {
            let newD = d + 1;
            let newM = m;
            if (newD > daysInMonth[m]) {
                newM = m === 12 ? 1 : m + 1;
                newD = 1;
            }
            setFeedbackDate(newM, newD);
        }
        // 清空授课内容
        document.getElementById('teachingContent').value = '';
        updateTeachingCharCount();
        // 清空作业
        document.getElementById('homeworkAssign').value = '';
        // 清空补充说明
        document.getElementById('customNote').value = '';
        // 重置水平等级（同步更新picker按钮文字）
        const levelInput = document.getElementById('studentLevel');
        if (levelInput) {
            levelInput.value = '';
            const wrap = document.getElementById('picker-studentLevel');
            if (wrap) {
                const btnText = wrap.querySelector('.picker-btn-text');
                if (btnText) { btnText.textContent = '水平等级 *'; btnText.classList.add('placeholder'); }
                wrap.querySelectorAll('.picker-item').forEach(i => i.classList.remove('selected'));
            }
        }
        // 清空预览区
        currentFeedback = '';
        document.getElementById('previewContent').classList.add('hidden');
        document.getElementById('previewContent').textContent = '';
        document.getElementById('previewEmpty').classList.remove('hidden');
        document.getElementById('previewMeta').classList.add('hidden');
        document.getElementById('previewActions').classList.add('hidden');
        document.getElementById('streamStatus').classList.add('hidden');
        document.getElementById('modelBadge').innerHTML = '';
        // 滚动到顶部
        window.scrollTo({ top: 0, behavior: 'smooth' });
        showToast('已清空，可以填写下一位学生信息', 'info');
    }

    // ============ 维度折叠/展开 ============
    let dimensionCollapsed = false;
    function toggleDimensionCollapse() {
        const wrapper = document.getElementById('dimensionGridWrapper');
        const toggle = document.getElementById('dimensionToggle');
        dimensionCollapsed = !dimensionCollapsed;
        if (dimensionCollapsed) {
            wrapper.style.maxHeight = '0px';
            toggle.textContent = '展开 ▼';
        } else {
            wrapper.style.maxHeight = '2000px';
            toggle.textContent = '收起 ▲';
        }
    }

    // ============ 一键复制反馈 ============
    async function quickCopyFeedback() {
        if (!currentFeedback) {
            showToast('请先生成反馈', 'error');
            return;
        }
        const success = await copyToClipboard(currentFeedback);
        if (success) {
            showToast('已复制到剪贴板！可直接粘贴发送', 'success');
        } else {
            showToast('复制失败，请手动选择文本后复制', 'error');
        }
    }

    // ============ 数据导出 ============
    async function exportData(format = 'csv') {
        showToast('正在准备导出数据...', 'info');
        try {
            const resp = await fetch('api.php?action=export_data&format=' + format);
            if (!resp.ok) {
                const err = await resp.json();
                showToast('导出失败：' + (err.message || '未知错误'), 'error');
                return;
            }
            
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const timestamp = new Date().toISOString().slice(0, 10);
            a.download = `学生反馈数据_${timestamp}.${format}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast('数据导出成功！', 'success');
        } catch (e) {
            showToast('导出失败：' + (e.message || '网络错误'), 'error');
        }
    }

    // ============ 授课内容字数统计 ============
    function updateTeachingCharCount() {
        const text = document.getElementById('teachingContent').value;
        const count = text.length;
        const el = document.getElementById('teachingCharCount');
        if (el) {
            let hint = `已输入 ${count} 字`;
            if (count < 10 && count > 0) hint += '（建议填写更详细的授课内容以获得更准确的反馈）';
            if (count === 0) hint = '尚未填写';
            el.textContent = hint;
        }
    }

    // ============ 渲染维度 ============
    function renderDimensions() {
        const grid = document.getElementById('dimensionGrid');
        grid.innerHTML = DIMENSIONS.map(dim => {
            const multiHint = dim.multi ? '<span style="font-size:10px;color:var(--primary);font-weight:400;margin-left:4px;">多选</span>' : '<span style="font-size:10px;color:var(--text-muted);font-weight:400;margin-left:4px;">单选</span>';
            const requiredHint = dim.required === false ? '<span style="font-size:10px;color:var(--text-muted);font-weight:400;margin-left:4px;">选填</span>' : '';
            return `
            <div class="dimension-item" id="dim-${dim.id}">
                <div class="dim-title">
                    <span class="dim-icon">${dim.icon}</span>${dim.title}${multiHint}${requiredHint}
                </div>
                <div class="dim-options">
                    ${dim.options.map(opt => `
                        <span class="dim-option${dim.multi ? ' multi-mode' : ''}" 
                              data-dim="${dim.id}" 
                              data-value="${escapeHtml(opt.value)}"
                              onclick="selectOption('${dim.id}', '${escapeHtml(opt.value)}', this, ${dim.multi || false})">
                            ${opt.label}
                        </span>
                    `).join('')}
                </div>
            </div>
        `}).join('');
    }

    function selectOption(dimId, value, el, isMulti) {
        const container = document.getElementById('dim-' + dimId);
        
        if (isMulti) {
            // 多选模式：切换
            const wasActive = el.classList.contains('active');
            
            if (wasActive) {
                // 取消选中：先移除类，再强制重绘
                el.classList.remove('active');
                // 强制触发重绘，确保华为等浏览器正确回退样式
                void el.offsetWidth;
                
                if (selectedDimensions[dimId]) {
                    selectedDimensions[dimId] = selectedDimensions[dimId].filter(v => v !== value);
                    if (selectedDimensions[dimId].length === 0) {
                        delete selectedDimensions[dimId];
                    }
                }
                // 检查该维度是否还有任何选中项，没有则移除selected样式
                const hasAnyActive = container.querySelector('.dim-option.active');
                if (!hasAnyActive) {
                    container.classList.remove('selected');
                    void container.offsetWidth;
                    delete selectedDimensions[dimId];
                }
            } else {
                // 选中
                el.classList.add('active');
                container.classList.add('selected');
                if (!selectedDimensions[dimId]) selectedDimensions[dimId] = [];
                if (!selectedDimensions[dimId].includes(value)) {
                    selectedDimensions[dimId].push(value);
                }
            }
        } else {
            // 单选模式：点击同一项取消，否则替换
            const wasActive = el.classList.contains('active');
            
            // 先清除同维度所有选项的active
            container.querySelectorAll('.dim-option').forEach(opt => {
                if (opt.classList.contains('active')) {
                    opt.classList.remove('active');
                    void opt.offsetWidth;
                }
            });
            
            if (!wasActive) {
                // 选中新选项
                el.classList.add('active');
                container.classList.add('selected');
                selectedDimensions[dimId] = value;
            } else {
                // 取消选中
                container.classList.remove('selected');
                void container.offsetWidth;
                delete selectedDimensions[dimId];
            }
        }
        updateDimensionStats(); // 更新选择统计
    }
    // escapeHtml 已在 utils.js 中定义
    // ============ 流式生成反馈（SSE） ============
    async function generateFeedbackStream() {
        streamFinished = false; // 重置幂等保护标志
        // 小班课多学生模式
        if (isMultiStudentMode) {
            return generateMultiStudentFeedback();
        }

        const teachingContent = document.getElementById('teachingContent').value.trim();
        if (!teachingContent) {
            showToast('请先填写授课内容', 'error');
            return;
        }

        const hasSelection = Object.keys(selectedDimensions).length > 0;
        if (!hasSelection) {
            showToast('请至少选择一个评价维度', 'error');
            return;
        }

        const studentName = document.getElementById('studentName').value.trim();
        if (!studentName) {
            showToast('请先填写学生姓名', 'error');
            return;
        }

        const studentLevel = document.getElementById('studentLevel').value.trim();
        if (!studentLevel) {
            showToast('请选择学生的水平等级（优秀/良好/中等/薄弱）', 'error');
            const pickerWrap = document.getElementById('picker-studentLevel');
            if (pickerWrap) {
                const btn = pickerWrap.querySelector('.picker-btn');
                if (btn) { btn.style.borderColor = 'var(--danger)'; btn.focus(); }
                setTimeout(() => { if (btn) btn.style.borderColor = ''; }, 2000);
            }
            return;
        }

        // 准备数据：多选值用逗号拼接
        const wordCountRange = document.getElementById('wordCountRange').value.trim();
        // 日期：从下拉框读取，未选择则默认当天
        let feedbackDate = getFeedbackDate();
        if (!feedbackDate) {
            const now = new Date();
            feedbackDate = (now.getMonth() + 1) + '.' + now.getDate();
            const parts = feedbackDate.split('.');
            setFeedbackDate(parseInt(parts[0]), parseInt(parts[1]));
        }
        const data = {
            student_name: studentName,
            student_level: document.getElementById('studentLevel').value.trim(),
            student_grade: document.getElementById('studentGrade').value.trim(),
            word_count_range: wordCountRange,
            teaching_content: teachingContent,
            homework_assign: document.getElementById('homeworkAssign').value.trim(),
            custom_note: document.getElementById('customNote').value.trim(),
            teaching_scene: document.getElementById('teachingScene').value.trim(),
            feedback_date: feedbackDate,
        };
        // 展开维度数据，多选转为逗号分隔字符串
        for (const [key, val] of Object.entries(selectedDimensions)) {
            data[key] = Array.isArray(val) ? val.join('，') : val;
        }

        // UI 切换：显示流式状态
        startStreamingUI();
        
        // 清空预览区并显示流式容器
        currentFeedback = '';
        document.getElementById('previewEmpty').classList.add('hidden');
        const contentEl = document.getElementById('previewContent');
        contentEl.classList.remove('hidden');
        contentEl.classList.add('streaming');
        contentEl.textContent = '';
        contentEl.scrollTop = 0;
        
        // 隐藏完成状态，显示流式状态
        document.getElementById('previewMeta').classList.add('hidden');
        document.getElementById('previewActions').classList.add('hidden');
        document.getElementById('streamStatus').classList.remove('hidden');

        // 创建 AbortController
        streamAbortController = new AbortController();

        // 设置超时（120秒）
        const timeoutId = setTimeout(() => {
            if (streamAbortController) {
                streamAbortController.abort();
                streamAbortController = null;
            }
            finishStreaming(false);
            showToast('请求超时（120秒），请检查网络或切换模型重试', 'error');
        }, 120000);

        try {
            const resp = await fetch('api.php?action=stream_feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
                signal: streamAbortController.signal,
            });

            clearTimeout(timeoutId);

            if (!resp.ok) {
                let errorDetail = '';
                try {
                    const errorBody = await resp.text();
                    if (errorBody) {
                        if (errorBody.includes('event: error')) {
                            const match = errorBody.match(/data:\s*(.+)/);
                            if (match) {
                                try {
                                    const parsed = JSON.parse(match[1]);
                                    errorDetail = typeof parsed === 'string' ? parsed : (parsed.message || '');
                                } catch (ex) {
                                    errorDetail = match[1];
                                }
                            }
                        }
                        if (!errorDetail) {
                            errorDetail = 'HTTP ' + resp.status + ' - ' + errorBody.substring(0, 200);
                        }
                    }
                } catch (ex) {
                    errorDetail = 'HTTP ' + resp.status;
                }
                finishStreaming(false);
                showToast('请求失败：' + (errorDetail || ('HTTP ' + resp.status)), 'error');
                return;
            }

            await processStreamResponse(resp);
        } catch (e) {
            clearTimeout(timeoutId);
            if (e.name === 'AbortError') {
                finishStreaming(false);
                showToast('已停止生成', 'info');
                return;
            }
            finishStreaming(false);
            showToast('请求失败：' + (e.message || '网络错误'), 'error');
        }
    }

    // 小班课多学生批量生成
    async function generateMultiStudentFeedback() {
        const teachingContent = document.getElementById('teachingContent').value.trim();
        if (!teachingContent) {
            showToast('请先填写授课内容', 'error');
            return;
        }

        // 验证学生列表
        const validStudents = multiStudentList.filter(s => s.name.trim());
        if (validStudents.length === 0) {
            showToast('请至少填写一位学生的姓名', 'error');
            return;
        }
        // 部分学生无姓名时给出提示
        const skippedStudents = multiStudentList.filter(s => !s.name.trim());
        if (skippedStudents.length > 0) {
            showToast('已自动跳过 ' + skippedStudents.length + ' 位未填写姓名的学生', 'info');
        }

        // 检查每位学生是否选择了评价维度
        const noDimsStudents = validStudents.filter(s => !s.dims || Object.keys(s.dims).length === 0);
        if (noDimsStudents.length > 0) {
            const names = noDimsStudents.map(s => s.name).join('、');
            showToast('以下学生未选择评价维度：' + names, 'error');
            return;
        }

        const wordCountRange = document.getElementById('wordCountRange').value.trim();
        let feedbackDate = getFeedbackDate();
        if (!feedbackDate) {
            const now = new Date();
            feedbackDate = (now.getMonth() + 1) + '.' + now.getDate();
            const parts = feedbackDate.split('.');
            setFeedbackDate(parseInt(parts[0]), parseInt(parts[1]));
        }

        // 构建批量请求数据
        const studentsData = validStudents.map(s => {
            const dims = {};
            for (const [key, val] of Object.entries(s.dims || {})) {
                dims[key] = Array.isArray(val) ? val.join('，') : val;
            }
            return {
                student_name: s.name.trim(),
                student_level: s.level || '',
                dims: dims,
            };
        });

        const data = {
            students: studentsData,
            student_grade: document.getElementById('studentGrade').value.trim(),
            word_count_range: wordCountRange,
            teaching_content: teachingContent,
            homework_assign: document.getElementById('homeworkAssign').value.trim(),
            custom_note: document.getElementById('customNote').value.trim(),
            teaching_scene: currentMultiScene || 'small_group',
            feedback_date: feedbackDate,
        };

        // UI 切换
        startStreamingUI();
        currentFeedback = '';
        document.getElementById('previewEmpty').classList.add('hidden');
        const contentEl = document.getElementById('previewContent');
        contentEl.classList.remove('hidden');
        contentEl.classList.add('streaming');
        contentEl.textContent = '';
        contentEl.scrollTop = 0;
        document.getElementById('previewMeta').classList.add('hidden');
        document.getElementById('previewActions').classList.add('hidden');
        document.getElementById('streamStatus').classList.remove('hidden');

        streamAbortController = new AbortController();

        // 小班课超时时间更长（学生多时）
        const studentCount = validStudents.length;
        const timeoutSec = Math.max(180, studentCount * 60);
        const timeoutId = setTimeout(() => {
            if (streamAbortController) {
                streamAbortController.abort();
                streamAbortController = null;
            }
            finishStreaming(false);
            showToast(`请求超时（${timeoutSec}秒），学生较多时建议分批生成`, 'error');
        }, timeoutSec * 1000);

        try {
            const resp = await fetch('api.php?action=stream_feedback_batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
                signal: streamAbortController.signal,
            });

            clearTimeout(timeoutId);

            if (!resp.ok) {
                let errorDetail = '';
                try {
                    const errorBody = await resp.text();
                    if (errorBody) {
                        if (errorBody.includes('event: error')) {
                            const match = errorBody.match(/data:\s*(.+)/);
                            if (match) {
                                try {
                                    const parsed = JSON.parse(match[1]);
                                    errorDetail = typeof parsed === 'string' ? parsed : (parsed.message || '');
                                } catch (ex) { errorDetail = match[1]; }
                            }
                        }
                        if (!errorDetail) errorDetail = 'HTTP ' + resp.status;
                    }
                } catch (ex) { errorDetail = 'HTTP ' + resp.status; }
                finishStreaming(false);
                showToast('请求失败：' + (errorDetail || ('HTTP ' + resp.status)), 'error');
                return;
            }

            await processStreamResponse(resp);
        } catch (e) {
            clearTimeout(timeoutId);
            if (e.name === 'AbortError') {
                finishStreaming(false);
                showToast('已停止生成', 'info');
                return;
            }
            finishStreaming(false);
            showToast('请求失败：' + (e.message || '网络错误'), 'error');
        }
    }

    async function processStreamResponse(resp) {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let currentEvent = '';
        let streamUsage = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                
                if (line.startsWith('event:')) {
                    currentEvent = line.substring(6).trim();
                    continue;
                }
                
                if (line.startsWith('data:')) {
                    const jsonStr = line.substring(5).trim();
                    
                    try {
                        const eventData = JSON.parse(jsonStr);
                        
                        if (currentEvent === 'text' || (!currentEvent && typeof eventData === 'string')) {
                            const delta = typeof eventData === 'string' ? eventData : '';
                            if (delta) {
                                currentFeedback += delta;
                                appendToPreview(delta);
                            }
                        } else if (currentEvent === 'usage') {
                            // 收到token用量信息和模型名
                            streamUsage = eventData;
                            streamModelName = eventData.model || '';
                            updateStreamToken(eventData);
                        } else if (currentEvent === 'error') {
                            finishStreaming(false);
                            showToast(typeof eventData === 'string' ? eventData : (eventData.message || '生成出错'), 'error');
                            return;
                        } else if (currentEvent === 'done') {
                            finishStreaming(true, streamUsage);
                            return;
                        }
                    } catch (e) {
                        // JSON解析失败，忽略
                    }
                    
                    currentEvent = '';
                }
            }
        }
        
        // 流正常结束
        finishStreaming(true, streamUsage);
    }

    function appendToPreview(text) {
        const contentEl = document.getElementById('previewContent');
        contentEl.textContent += text;
        // 自动滚动到底部
        contentEl.scrollTop = contentEl.scrollHeight;
        
        // 更新字数统计（带目标范围提示）
        const count = currentFeedback.length;
        const rangeStr = document.getElementById('wordCountRange').value || '200-400';
        const parts = rangeStr.split('-');
        const targetMin = parseInt(parts[0]) || 200;
        const targetMax = parseInt(parts[1]) || 400;
        let countHint = `已生成 ${count} 字`;
        if (count < targetMin) {
            countHint += `（目标 ${targetMin}-${targetMax} 字）`;
        } else if (count <= targetMax) {
            countHint += ` ✅ 已达目标范围`;
        } else {
            countHint += `（已超出目标 ${targetMax} 字）`;
        }
        document.getElementById('streamingText').textContent = `AI正在生成中... ${countHint}`;
        document.getElementById('streamCharCount').textContent = `${count} 字 / 目标 ${targetMin}-${targetMax} 字`;
    }

    function startStreamingUI() {
        document.getElementById('btnGenerate').classList.add('hidden');
        document.getElementById('btnStop').classList.remove('hidden');
        document.getElementById('generatingHint').classList.remove('hidden');
        document.getElementById('streamingText').textContent = 'AI正在生成中...';
    }

    function stopStreaming() {
        if (streamAbortController) {
            streamAbortController.abort();
            streamAbortController = null;
        }
    }

    function updateStreamToken(usage) {
        if (usage && (usage.total_tokens > 0 || usage.prompt_tokens > 0 || usage.completion_tokens > 0)) {
            document.getElementById('streamTokenInfo').style.display = '';
            document.getElementById('streamTokenCount').textContent = usage.total_tokens || (usage.prompt_tokens + usage.completion_tokens) || 0;
            document.getElementById('streamStatusText').textContent = 'AI正在生成中...';
            // 显示模型名
            if (usage.model) {
                const modelBadge = document.getElementById('streamModelBadge');
                modelBadge.style.display = '';
                modelBadge.textContent = '模型：' + usage.model;
            }
        } else if (usage && usage._estimated) {
            // API未返回token数据，但已做了估算
            document.getElementById('streamTokenInfo').style.display = '';
            document.getElementById('streamTokenCount').textContent = '~' + (usage.total_tokens || 0);
            document.getElementById('streamStatusText').textContent = 'AI正在生成中...';
            if (usage.model) {
                const modelBadge = document.getElementById('streamModelBadge');
                modelBadge.style.display = '';
                modelBadge.textContent = '模型：' + usage.model;
            }
        }
    }

    let streamFinished = false; // 幂等保护标志

    function finishStreaming(success, usage) {
        // 幂等保护：防止重复调用导致UI状态异常（如processStreamResponse中done事件和reader完成双重触发）
        if (streamFinished) return;
        streamFinished = true;
        
        streamAbortController = null;
        
        document.getElementById('btnGenerate').classList.remove('hidden');
        document.getElementById('btnStop').classList.add('hidden');
        document.getElementById('generatingHint').classList.add('hidden');
        
        const contentEl = document.getElementById('previewContent');
        contentEl.classList.remove('streaming');
        
        document.getElementById('streamStatus').classList.add('hidden');
        document.getElementById('streamTokenInfo').style.display = 'none';
        document.getElementById('streamModelBadge').style.display = 'none';
        
        if (success && currentFeedback) {
            document.getElementById('previewMeta').classList.remove('hidden');
            const modelName = streamModelName || 'qwen-plus';
            document.getElementById('previewModel').textContent = modelName;
            
            // 完整时间格式
            const now = new Date();
            const timeStr = now.getFullYear() + '/' + (now.getMonth()+1) + '/' + now.getDate() + ' ' +
                String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0') + ':' + String(now.getSeconds()).padStart(2,'0');
            document.getElementById('previewTime').textContent = timeStr;
            
            // 显示字数
            document.getElementById('previewCharCount').textContent = '共 ' + currentFeedback.length + ' 字';
            
            // 显示token消耗（更清晰的格式）
            const tokenMeta = document.getElementById('previewTokenMeta');
            const totalTokens = usage ? (usage.total_tokens || (usage.prompt_tokens + usage.completion_tokens) || 0) : 0;
            if (totalTokens > 0) {
                const estimated = usage && usage._estimated ? '（估算）' : '';
                tokenMeta.textContent = '🎫 ' + totalTokens + ' tokens' + estimated + ' (输入' + (usage.prompt_tokens || 0) + ' + 输出' + (usage.completion_tokens || 0) + ')';
            } else {
                tokenMeta.textContent = '';
            }
            
            document.getElementById('previewActions').classList.remove('hidden');
            document.getElementById('modelBadge').innerHTML = '当前模型：' + modelName + ' · ' + currentFeedback.length + ' 字';
            
            // 在流式状态栏也显示完整信息
            const rangeStr = document.getElementById('wordCountRange').value || '200-400';
            const parts = rangeStr.split('-');
            const tMin = parseInt(parts[0]) || 200;
            const tMax = parseInt(parts[1]) || 400;
            let countStatus = '';
            if (currentFeedback.length < tMin) countStatus = `（不足目标 ${tMin}-${tMax} 字）`;
            else if (currentFeedback.length <= tMax) countStatus = `（已达目标 ${tMin}-${tMax} 字 ✅）`;
            else countStatus = `（超出目标 ${tMax} 字）`;
            document.getElementById('streamCharCount').textContent = currentFeedback.length + ' 字' + countStatus;
            
            showToast('反馈生成完成！共 ' + currentFeedback.length + ' 字', 'success');
            
            // ============ 反馈质量自检 ============
            setTimeout(() => runQualityCheck(currentFeedback), 500);
        } else if (!currentFeedback) {
            // 没有内容，恢复空状态
            document.getElementById('previewEmpty').classList.remove('hidden');
            contentEl.classList.add('hidden');
        }
    }

    // 保留 generateFeedback 作为 generateFeedbackStream 的别名
    async function generateFeedback() {
        // 先取消旧请求，等待abort完成后再启动新请求
        if (streamAbortController) {
            streamAbortController.abort();
            streamAbortController = null;
            // 等待一小段时间让abort生效
            await new Promise(resolve => setTimeout(resolve, 150));
        }
        generateFeedbackStream();
    }

    async function regenerateFeedback() {
        if (!document.getElementById('teachingContent').value.trim()) {
            showToast('授课内容为空，无法重新生成', 'error');
            return;
        }
        // 取消当前流，等待abort完成
        if (streamAbortController) {
            streamAbortController.abort();
            streamAbortController = null;
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        generateFeedbackStream();
    }

    // ============ 分享功能 ============
    function openShareModal() {
        document.getElementById('shareModal').classList.remove('hidden');
        document.getElementById('shareCopiedHint').style.display = 'none';
        // 检测是否支持原生分享
        const nativeShareBtn = document.getElementById('btnNativeShare');
        if (navigator.share) {
            nativeShareBtn.style.display = '';
        } else {
            nativeShareBtn.style.display = 'none';
        }
    }

    function closeShareModal() {
        document.getElementById('shareModal').classList.add('hidden');
    }

    async function shareToPlatform() {
        openShareModal();
    }

    async function copyAndOpen(platform) {
        if (!currentFeedback) return;
        
        // 复制到剪贴板
        await copyToClipboard(currentFeedback);

        // 显示已复制提示
        document.getElementById('shareCopiedHint').style.display = 'block';

        // 根据不同平台尝试打开对应的 scheme（移动端有效）
        const schemes = {
            'weixin': 'weixin://',
            'wecom': 'wxwork://',
            'dingtalk': 'dingtalk://',
        };
        const scheme = schemes[platform];
        
        if (scheme) {
            // 尝试唤起 App
            const opened = tryOpenScheme(scheme);
            
            // 延迟显示引导提示
            setTimeout(() => {
                const hints = {
                    'weixin': '已复制！请打开微信，长按输入框粘贴发送',
                    'wecom': '已复制！请打开企业微信，长按输入框粘贴发送',
                    'dingtalk': '已复制！请打开钉钉，长按输入框粘贴发送',
                    'clipboard': '已复制到剪贴板！可粘贴到任意聊天窗口',
                };
                showToast(hints[platform] || '已复制到剪贴板', 'success');
            }, 600);
        } else {
            showToast('已复制到剪贴板！可粘贴到任意聊天窗口', 'success');
        }
    }

    function tryOpenScheme(url) {
        // 尝试通过 iframe 或 location 唤起 App
        const start = Date.now();
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = url;
        document.body.appendChild(iframe);
        setTimeout(() => {
            document.body.removeChild(iframe);
        }, 2000);
        
        // 也尝试直接跳转（部分浏览器支持）
        try {
            window.open(url, '_blank');
        } catch(e) {}
        
        return true;
    }

    async function shareViaWebShare() {
        if (!currentFeedback) return;
        
        if (navigator.share) {
            try {
                await navigator.share({
                    title: '课后反馈',
                    text: currentFeedback,
                });
                showToast('分享成功', 'success');
            } catch (e) {
                // 用户取消分享，不提示
            }
            closeShareModal();
        } else {
            // 不支持原生分享，回退到复制（先显示提示再关闭弹窗）
            await copyAndOpen('clipboard');
            // 延迟关闭弹窗，让用户看到"已复制"提示
            setTimeout(() => closeShareModal(), 1500);
        }
    }

    // ============ API配置 ============
    async function openConfigModal() {
        document.getElementById('configModal').classList.remove('hidden');
        await loadConfig();
    }

    function closeConfigModal() {
        document.getElementById('configModal').classList.add('hidden');
    }

    async function loadConfig() {
        try {
            const resp = await fetch('api.php?action=get_config');
            const result = await resp.json();
            if (result.success && result.data) {
                const data = result.data;
                const keyInput = document.getElementById('apiKey');
                const keyHint = document.getElementById('keyHint');
                const savedKeyInfo = document.getElementById('savedKeyInfo');

                // 已保存的 Key 掩码展示
                if (data.api_key_masked && data.api_key_masked !== '(空)') {
                    savedKeyInfo.classList.remove('hidden');
                    document.getElementById('keyMaskDisplay').textContent = data.api_key_masked;
                    document.getElementById('keyVerifyResult').innerHTML = '<span style="color:#94A3B8;">模型：' + (data.model || '—') + ' · 点击"验证Key"检测有效性</span>';
                    keyInput.value = '';
                    keyInput.placeholder = '输入新Key替换，或留空保留当前Key';
                    keyHint.style.display = 'inline';
                } else {
                    savedKeyInfo.classList.add('hidden');
                    keyInput.value = '';
                    keyInput.placeholder = '请输入千问API Key（sk-...）';
                    keyHint.style.display = 'none';
                }

                document.getElementById('modelSelect').value = data.model || 'qwen-plus';
                document.getElementById('temperature').value = data.temperature || 0.7;
                document.getElementById('tempValue').textContent = (data.temperature || 0.7).toFixed(1);
                document.getElementById('maxTokens').value = data.max_tokens || 2000;
                document.getElementById('modelBadge').innerHTML = '当前模型：' + (data.model || 'qwen-plus');
            } else {
                // 配置加载失败或没有配置
                const savedKeyInfo = document.getElementById('savedKeyInfo');
                const keyInput = document.getElementById('apiKey');
                const keyHint = document.getElementById('keyHint');
                savedKeyInfo.classList.add('hidden');
                keyInput.value = '';
                keyInput.placeholder = '请输入千问API Key（sk-...）';
                keyHint.style.display = 'none';
            }
        } catch (e) {
            // 网络错误等，确保UI状态一致
            const savedKeyInfo = document.getElementById('savedKeyInfo');
            const keyInput = document.getElementById('apiKey');
            const keyHint = document.getElementById('keyHint');
            savedKeyInfo.classList.add('hidden');
            keyInput.value = '';
            keyInput.placeholder = '请输入千问API Key（sk-...）';
            keyHint.style.display = 'none';
        }
    }

    // 验证 API Key 有效性
    async function verifyKey() {
        const btn = document.getElementById('btnVerifyKey');
        const resultEl = document.getElementById('keyVerifyResult');
        btn.disabled = true;
        btn.textContent = '⏳ 验证中...';
        resultEl.innerHTML = '<span style="color:#94A3B8;">正在验证 API Key...</span>';

        try {
            const resp = await fetch('api.php?action=verify_key');
            const result = await resp.json();
            if (result.success && result.data) {
                const d = result.data;
                if (d.key_valid) {
                    resultEl.innerHTML = '<span style="color:#059669;">✅ Key 有效 · 当前模型：' + d.current_model + ' · HTTP ' + d.http_code + '</span>';
                } else {
                    resultEl.innerHTML = '<span style="color:#DC2626;">❌ ' + (d.message || 'Key 无效') + '</span>';
                }
            } else {
                resultEl.innerHTML = '<span style="color:#DC2626;">❌ 验证失败：' + (result.message || '未知错误') + '</span>';
            }
        } catch (e) {
            resultEl.innerHTML = '<span style="color:#DC2626;">❌ 网络错误：' + e.message + '</span>';
        } finally {
            btn.disabled = false;
            btn.textContent = '🔄 验证Key';
        }
    }

    // 删除已保存的 API Key
    async function deleteApiKey() {
        if (!confirm('确定要删除已保存的API Key吗？\n\n删除后需要重新配置Key才能使用AI生成功能。')) return;
        
        const btn = document.getElementById('btnDeleteKey');
        btn.disabled = true;
        btn.textContent = '⏳ 删除中...';
        
        try {
            const resp = await fetch('api.php?action=delete_config', { method: 'POST' });
            const result = await resp.json();
            if (result.success) {
                showToast('API Key 已删除', 'success');
                closeConfigModal();
                // 更新顶部模型显示（清空）
                document.getElementById('modelBadge').innerHTML = '';
            } else {
                showToast(result.message || '删除失败', 'error');
            }
        } catch (e) {
            showToast('删除失败：' + e.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = '🗑 删除Key';
        }
    }

    async function saveConfig() {
        const apiKeyInput = document.getElementById('apiKey');
        const apiKey = apiKeyInput.value.trim();
        const hasSavedKey = !document.getElementById('savedKeyInfo').classList.contains('hidden');
        
        // 输入校验
        if (!apiKey && !hasSavedKey) {
            showToast('请先输入千问API Key（sk-开头）', 'error');
            apiKeyInput.focus();
            return;
        }
        if (apiKey && apiKey.startsWith('••••••••')) {
            showToast('请重新输入有效的API Key，不要使用掩码格式', 'error');
            apiKeyInput.value = '';
            apiKeyInput.focus();
            return;
        }
        if (apiKey && !apiKey.startsWith('sk-')) {
            showToast('API Key格式不正确，千问Key应以 sk- 开头', 'error');
            return;
        }

        const data = {
            api_key: apiKey,  // 空字符串时后端自动复用已有Key
            model: document.getElementById('modelSelect').value,
            temperature: parseFloat(document.getElementById('temperature').value),
            max_tokens: parseInt(document.getElementById('maxTokens').value)
        };

        // 禁用保存按钮防止重复提交
        const saveBtns = document.querySelectorAll('#configModal .btn-primary');
        saveBtns.forEach(b => { b.disabled = true; b.textContent = '⏳ 保存中...'; });

        try {
            const resp = await fetch('api.php?action=save_config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await resp.json();
            if (result.success) {
                showToast(result.message || '配置保存成功！', 'success');
                closeConfigModal();
                // 刷新顶部模型显示（含检测结果）
                setTimeout(() => loadConfigForBadge(), 300);
            } else {
                showToast(result.message || '保存失败', 'error');
                // 如果是解密失败，提示用户重新输入Key
                if (result.message && result.message.includes('解密')) {
                    document.getElementById('savedKeyInfo').classList.add('hidden');
                    apiKeyInput.value = '';
                    apiKeyInput.placeholder = '请重新输入千问API Key（sk-...）';
                    apiKeyInput.focus();
                }
            }
        } catch (e) {
            showToast('网络错误，保存失败：' + (e.message || '请检查网络连接'), 'error');
        } finally {
            saveBtns.forEach(b => { b.disabled = false; b.textContent = '💾 保存配置'; });
        }
    }

    // ============ 历史记录 ============
    function openHistoryModal() {
        document.getElementById('historyModal').classList.remove('hidden');
        // 退出选择模式并清空搜索（除非从档案进入）
        if (!historyFromProfile) {
            cancelSelectMode();
            historySearchTerm = '';
            historyStudentFilter = '';
            historyPage = 1;
            document.getElementById('historySearch').value = '';
            // 隐藏档案筛选UI
            const profileTag = document.getElementById('profileFilterTag');
            const profileBtn = document.getElementById('btnProfileBack');
            if (profileTag) { profileTag.textContent = ''; profileTag.classList.add('hidden'); }
            if (profileBtn) profileBtn.classList.add('hidden');
        }
        loadHistory();
    }

    function closeHistoryModal() {
        closeHistoryModalImpl();
    }
    
    function closeHistoryModalImpl() {
        document.getElementById('historyModal').classList.add('hidden');
        historyFromProfile = '';
    }

    // ============ 系统诊断 ============
    function openDiagnoseModal() {
        document.getElementById('diagnoseModal').classList.remove('hidden');
        runDiagnose();
    }

    function closeDiagnoseModal() {
        document.getElementById('diagnoseModal').classList.add('hidden');
    }

    async function runDiagnose() {
        const resultEl = document.getElementById('diagnoseResult');
        resultEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);"><span class="spinner" style="display:inline-block;"></span><p style="margin-top:12px;">正在全面检测系统状态...</p></div>';

        try {
            const resp = await fetch('api.php?action=diagnose');
            const result = await resp.json();
            const info = result.diagnose || {};

            const okIcon = '✅', failIcon = '❌', warnIcon = '⚠️';
            const okColor = 'var(--success)', failColor = 'var(--danger)', warnColor = 'var(--warning)';

            let html = '<div style="font-size:13px;line-height:2;">';

            // ========== 环境信息 ==========
            html += '<div style="margin-bottom:12px;padding:10px 14px;background:var(--bg);border-radius:var(--radius-sm);">';
            html += '<strong>📌 环境信息</strong><br>';
            html += 'PHP 版本：<code>' + (info.php_version || '未知') + '</code><br>';
            html += '服务器：' + (info.server || '未知') + '<br>';
            html += '系统：' + (info.os || '未知') + '<br>';
            html += '内存限制：' + (info.memory_limit || '—') + ' · 超时：' + (info.max_execution_time || '—');
            html += '</div>';

            // ========== PHP 扩展 ==========
            html += '<div style="margin-bottom:12px;padding:10px 14px;background:var(--bg);border-radius:var(--radius-sm);">';
            html += '<strong>🧩 PHP 扩展</strong><br>';
            const curlOk = info.curl_enabled;
            const sslOk  = info.openssl_enabled;
            const sqliteOk = info.sqlite_enabled;
            const jsonOk = info.json_enabled !== false;
            const mbstringOk = info.mbstring_enabled !== false;
            html += `${curlOk ? okIcon : failIcon} curl：<span style="color:${curlOk ? okColor : failColor};">${curlOk ? '已启用' : '未启用（无法调用AI API）'}</span><br>`;
            html += `${sslOk ? okIcon : failIcon} openssl：<span style="color:${sslOk ? okColor : failColor};">${sslOk ? '已启用' : '未启用（无法加密）'}</span><br>`;
            html += `${sqliteOk ? okIcon : failIcon} sqlite3：<span style="color:${sqliteOk ? okColor : failColor};">${sqliteOk ? '已启用' : '未启用（无法存储数据）'}</span><br>`;
            html += `${jsonOk ? okIcon : failIcon} json · mbstring：${mbstringOk ? okIcon : failIcon}`;
            html += '</div>';

            // ========== 网络连接 ==========
            html += '<div style="margin-bottom:12px;padding:10px 14px;background:var(--bg);border-radius:var(--radius-sm);">';
            html += '<strong>🌐 网络连接</strong><br>';
            const dnsOk = info.dns_resolve && info.dns_resolve.startsWith('OK');
            const tcpOk = info.tcp_connect_443 && info.tcp_connect_443.startsWith('OK');
            const curlTestOk = info.curl_test && info.curl_test.startsWith('OK');
            html += `${dnsOk ? okIcon : failIcon} DNS解析：<span style="color:${dnsOk ? okColor : failColor};font-size:11px;">${info.dns_resolve || '未知'}</span><br>`;
            html += `${tcpOk ? okIcon : failIcon} TCP连接(443)：<span style="color:${tcpOk ? okColor : failColor};font-size:11px;">${info.tcp_connect_443 || '未知'}</span><br>`;
            html += `${curlTestOk ? okIcon : failIcon} API连通：<span style="color:${curlTestOk ? okColor : failColor};font-size:11px;">${info.curl_test || '未知'}</span>`;
            html += '</div>';

            // ========== API 配置 ==========
            const apiConfigured = info.api_configured && info.api_configured.startsWith('YES');
            html += '<div style="margin-bottom:12px;padding:10px 14px;background:var(--bg);border-radius:var(--radius-sm);">';
            html += '<strong>🔑 API 配置</strong><br>';
            html += `${apiConfigured ? okIcon : failIcon} Key：<span style="color:${apiConfigured ? okColor : failColor};">${apiConfigured ? '已配置' : '未配置'}</span>`;
            if (info.api_model) {
                html += ' · 模型：<code>' + info.api_model + '</code>';
            }
            html += '</div>';

            // ========== 数据库 ==========
            html += '<div style="margin-bottom:12px;padding:10px 14px;background:var(--bg);border-radius:var(--radius-sm);">';
            html += '<strong>🗄️ 数据库</strong><br>';
            const dbOk = info.db_status && info.db_status.startsWith('OK');
            html += `${dbOk ? okIcon : failIcon} SQLite：<span style="color:${dbOk ? okColor : failColor};">${info.db_status || '未知'}</span>`;
            if (info.db_size) html += ' · ' + info.db_size;
            if (info.db_records !== undefined) html += ' · ' + info.db_records + '条记录 · ' + (info.db_students || 0) + '个学生';
            html += '<br>';
            const dataDirOk = info.data_dir_writable !== false;
            html += `${dataDirOk ? okIcon : failIcon} data/目录：<span style="color:${dataDirOk ? okColor : failColor};">${dataDirOk ? '可写' : '不可写'}</span>`;
            html += '</div>';

            // ========== 总体状态 ==========
            const allOk = curlOk && sslOk && sqliteOk && jsonOk && mbstringOk && dnsOk && tcpOk && curlTestOk && apiConfigured && dataDirOk && dbOk;
            const partialOk = curlOk && sslOk && sqliteOk && dnsOk && tcpOk && curlTestOk;
            html += '<div style="text-align:center;padding:10px;border-radius:var(--radius-sm);margin-bottom:12px;' +
                     'background:' + (allOk ? '#ECFDF5' : partialOk ? '#FFFBEB' : '#FEF2F2') + ';color:' + (allOk ? 'var(--success)' : partialOk ? 'var(--warning)' : 'var(--danger)') + ';' +
                     'font-weight:700;font-size:13px;">' +
                     (allOk ? '✅ 系统状态正常' : partialOk ? '⚠️ 基本可用，部分需关注' : '❌ 存在严重问题') +
                     '</div>';

            // ========== API 端点调试（重点增强区域） ==========
            const apiBase = window.location.origin + window.location.pathname.replace('index.html', '') + 'api.php';
            
            html += '<div style="margin-bottom:12px;padding:12px;background:#FFF7ED;border-radius:var(--radius-sm);border:1px solid #FED7AA;">';
            html += '<strong style="color:#C2410C;">🔍 查看原始错误详情</strong><br>';
            html += '<div style="font-size:11px;color:#9A3412;margin:6px 0;">在浏览器地址栏输入下方URL，可直接查看API返回的原始错误信息（含403/400等具体错误原因）：</div>';
            html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">';
            
            const errorDebugEndpoints = [
                { label: '📋 查看系统诊断', url: apiBase + '?action=diagnose', tip: '查看PHP环境、网络、数据库等状态' },
                { label: '🔑 查看Key状态', url: apiBase + '?action=verify_key', tip: '查看Key是否有效、当前模型' },
                { label: '🤖 查看当前配置', url: apiBase + '?action=get_config', tip: '查看已保存的API配置' },
                { label: '🧪 测试模型可用', url: apiBase + '?action=test_all_models', tip: '一键测试所有模型是否可用' },
                { label: '📊 Token统计', url: apiBase + '?action=token_stats', tip: '查看累计Token消耗' },
                { label: '💰 配额信息', url: apiBase + '?action=quota_info', tip: '查询账户用量' },
            ];
            
            errorDebugEndpoints.forEach(ep => {
                html += '<button onclick="window.open(\'' + ep.url + '\',\'_blank\')" ' +
                    'title="' + ep.tip + '" ' +
                    'style="font-size:11px;padding:5px 10px;border:1px solid #FED7AA;border-radius:14px;background:white;color:#C2410C;cursor:pointer;white-space:nowrap;" ' +
                    'onmouseover="this.style.background=\'#FFF7ED\';this.style.borderColor=\'#EA580C\';" ' +
                    'onmouseout="this.style.background=\'white\';this.style.borderColor=\'#FED7AA\';">' + ep.label + '</button>';
            });
            
            html += '</div>';
            html += '<div style="font-size:11px;color:#9A3412;margin-top:8px;line-height:1.6;">';
            html += '💡 <b>使用技巧：</b><br>';
            html += '1. 点击上方按钮 → 新标签页打开API端点 → 查看JSON响应中的 <code>message</code>/<code>error</code> 字段<br>';
            html += '2. 如遇403，响应会显示具体原因（Key无权限/模型未开通等）<br>';
            html += '3. <b>"测试模型可用"</b> 会逐一检测所有模型，找出哪些能用、哪些需要开通';
            html += '</div>';
            html += '</div>';

            // ========== 模型批量测试区域 ==========
            html += '<div id="modelTestSection" style="margin-bottom:12px;padding:12px;background:var(--bg);border-radius:var(--radius-sm);">';
            html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">';
            html += '<strong>🤖 模型可用性检测</strong>';
            html += '<button id="btnTestAllModels" onclick="testAllModels()" style="font-size:12px;padding:6px 14px;border:1px solid var(--primary);border-radius:16px;background:white;color:var(--primary);cursor:pointer;font-weight:600;">▶ 开始检测所有模型</button>';
            html += '</div>';
            html += '<div id="modelTestResult" style="font-size:11px;color:var(--text-muted);">点击上方按钮，检测所有配置的千问模型是否可用（约需10-20秒）</div>';
            html += '</div>';

            html += '</div>';
            resultEl.innerHTML = html;

            // 异步加载 Key验证 + Token统计 + 配额信息 + 模型检测结果
            // 并行加载，但按固定顺序追加HTML（避免顺序错乱）
            loadDiagnoseDetails(resultEl, okIcon, failIcon, okColor, failColor);
        } catch (e) {
            resultEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger);">❌ 诊断请求失败：' + e.message + '<br><button class="btn btn-ghost btn-sm" onclick="runDiagnose()" style="margin-top:8px;">重试</button></div>';
        }
    }

    // 并行加载诊断详情并按顺序追加HTML（解决异步innerHTML+=顺序错乱问题）
    async function loadDiagnoseDetails(resultEl, okIcon, failIcon, okColor, failColor) {
        const [verifyHtml, statsHtml, quotaHtml, modelCheckHtml] = await Promise.allSettled([
            loadVerifyKeyInDiagnoseAsync(okIcon, failIcon, okColor, failColor),
            loadTokenStatsInDiagnoseAsync(),
            loadQuotaInDiagnoseAsync(),
            loadModelCheckInDiagnoseAsync(),
        ]);
        // 按固定顺序追加HTML
        const appendHtml = (html) => { if (html) resultEl.innerHTML += html; };
        appendHtml(verifyHtml.value);
        appendHtml(statsHtml.value);
        appendHtml(quotaHtml.value);
        // modelCheck 的结果在 modelTestResult 中显示，不追加
    }

    // 诊断弹窗中异步加载 Key 验证（返回HTML字符串，解决顺序错乱）
    async function loadVerifyKeyInDiagnoseAsync(okIcon, failIcon, okColor, failColor) {
        try {
            const verifyResp = await fetch('api.php?action=verify_key');
            const verifyResult = await verifyResp.json();
            if (verifyResult.success && verifyResult.data) {
                const vd = verifyResult.data;
                const keyMask = vd.key_masked || '—';
                const keyValid = vd.key_valid;
                let verifyHtml = '<div style="margin-bottom:12px;padding:10px 14px;background:var(--bg);border-radius:var(--radius-sm);">';
                verifyHtml += '<strong>🔍 API Key 验证</strong><br>';
                verifyHtml += 'Key：<code style="background:#F1F5F9;padding:2px 6px;border-radius:4px;">' + keyMask + '</code><br>';
                verifyHtml += `${keyValid ? okIcon : failIcon} 有效性：<span style="color:${keyValid ? okColor : failColor};font-weight:600;">${keyValid ? '有效 ✅' : '无效 ❌'}</span>`;
                if (vd.message) verifyHtml += ' · ' + vd.message;
                verifyHtml += '<br>';
                verifyHtml += 'HTTP状态：' + (vd.http_code || '—');
                if (vd.usage && vd.usage.total_tokens) {
                    verifyHtml += ' · 验证消耗：' + vd.usage.total_tokens + 't';
                }
                verifyHtml += '</div>';

                // 模型列表
                if (vd.models_available) {
                    verifyHtml += '<div style="margin-bottom:12px;padding:10px 14px;background:var(--bg);border-radius:var(--radius-sm);">';
                    verifyHtml += '<strong>📋 配置的模型列表</strong><br>';
                    verifyHtml += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">';
                    for (const [key, label] of Object.entries(vd.models_available)) {
                        const isCurrent = key === vd.current_model;
                        verifyHtml += '<span style="font-size:11px;padding:2px 8px;border-radius:10px;' +
                            (isCurrent ? 'background:#EEF2FF;color:var(--primary);font-weight:600;border:1px solid var(--primary);' : 'background:white;color:var(--text-secondary);border:1px solid var(--border);') + '">' +
                            (isCurrent ? '⭐ ' : '') + key + '</span>';
                    }
                    verifyHtml += '</div></div>';
                }
                return verifyHtml;
            }
        } catch (e) { /* 静默处理 */ }
        return '';
    }

    // 保留旧函数名作为兼容（如果有外部调用）
    function loadVerifyKeyInDiagnose(okIcon, failIcon, okColor, failColor) {
        // 已迁移到 loadVerifyKeyInDiagnoseAsync，此函数保留兼容
    }

    // ============ 诊断弹窗中加载已保存的模型检测结果 ============
    async function loadModelCheckInDiagnoseAsync() {
        const resultDiv = document.getElementById('modelTestResult');
        if (!resultDiv) return '';
        
        try {
            const resp = await fetch('api.php?action=get_config');
            const result = await resp.json();
            const check = result.model_check || null;
            
            if (!check || check.total <= 0) {
                return ''; // 无检测结果，保持默认提示文字
            }
            
            const timeStr = check.checked_at ? formatCheckTime(check.checked_at) : '';
            
            let html = '<div style="margin-top:8px;">';
            html += '<div style="font-size:11px;margin-bottom:6px;padding:5px 10px;border-radius:6px;' +
                (check.forbidden > 0 ? 'background:#FEF2F2;color:#991B1B;' : 'background:#ECFDF5;color:#065F46;') + '">';
            html += '共检测 <b>' + check.total + '</b> 个模型，可用 <b>' + check.available + '</b> 个' +
                (check.forbidden > 0 ? '，<b style="color:#DC2626;">' + check.forbidden + '</b> 个需开通权限' : '');
            html += ' · 当前使用：<b>' + (check.current_model || '—') + '</b>';
            if (timeStr) {
                html += ' · <span style="font-size:10px;opacity:0.7;">' + timeStr + '</span>';
            }
            html += '</div>';
            html += '<div style="font-size:10px;color:var(--text-muted);">以上为上次检测结果，点击上方按钮可重新检测</div>';
            html += '</div>';
            
            if (resultDiv) resultDiv.innerHTML = html;
            return ''; // modelCheck 结果在 modelTestResult 中显示，不追加到 diagnoseResult
        } catch (e) {
            return '';
        }
    }

    // 保留兼容函数
    function loadModelCheckInDiagnose() { /* 已迁移到 Async 版本 */ }

    // ============ 批量测试所有模型（诊断弹窗中） ============
    async function testAllModels() {
        const btn = document.getElementById('btnTestAllModels');
        const resultDiv = document.getElementById('modelTestResult');
        
        btn.disabled = true;
        btn.textContent = '⏳ 检测中...';
        btn.style.opacity = '0.6';
        resultDiv.innerHTML = '<span class="spinner" style="display:inline-block;width:14px;height:14px;"></span> 正在逐一测试所有模型，请稍候（约10-20秒）...';

        try {
            const resp = await fetch('api.php?action=test_all_models');
            const result = await resp.json();
            
            if (!result.success) {
                resultDiv.innerHTML = '<span style="color:var(--danger);">检测失败：' + (result.message || '未知错误') + '</span>';
                btn.disabled = false;
                btn.textContent = '▶ 重新检测';
                btn.style.opacity = '1';
                return;
            }

            const d = result.data;
            const now = new Date();
            const timeStr = now.toLocaleString('zh-CN', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' });
            
            let testHtml = '<div style="margin-top:8px;">';
            
            // 统计摘要 + 检测时间
            testHtml += '<div style="font-size:11px;margin-bottom:6px;padding:5px 10px;border-radius:6px;' +
                (d.forbidden > 0 ? 'background:#FEF2F2;color:#991B1B;' : 'background:#ECFDF5;color:#065F46;') + '">';
            testHtml += '共检测 <b>' + d.total + '</b> 个模型，可用 <b>' + d.available + '</b> 个' +
                (d.forbidden > 0 ? '，<b style="color:#DC2626;">' + d.forbidden + '</b> 个需开通权限' : '');
            testHtml += ' · 当前使用：<b>' + d.current_model + '</b>';
            testHtml += ' · <span style="font-size:10px;opacity:0.7;">' + timeStr + '</span>';
            testHtml += '</div>';

            // 逐个模型结果
            d.results.forEach(r => {
                let statusIcon, statusColor, bgColor;
                switch (r.status) {
                    case 'ok':
                        statusIcon = '✅'; statusColor = '#065F46'; bgColor = '#ECFDF5';
                        break;
                    case 'forbidden':
                        statusIcon = '🔒'; statusColor = '#991B1B'; bgColor = '#FEF2F2';
                        break;
                    case 'bad_request':
                        statusIcon = '❓'; statusColor = '#92400E'; bgColor = '#FFFBEB';
                        break;
                    default:
                        statusIcon = '❌'; statusColor = '#991B1B'; bgColor = '#FEF2F2';
                }
                
                const isCurrent = r.is_current ? ' · <span style="color:var(--primary);font-weight:600;">当前使用</span>' : '';
                
                testHtml += '<div style="display:flex;align-items:center;justify-content:space-between;padding:3px 8px;margin:1px 0;border-radius:4px;background:' + bgColor + ';font-size:11px;">';
                testHtml += '<span><span style="font-weight:600;">' + statusIcon + ' <code>' + r.model + '</code></span>' + isCurrent + '</span>';
                testHtml += '<span style="color:' + statusColor + ';">' + r.detail + ' · ' + r.latency_ms + 'ms</span>';
                testHtml += '</div>';
            });

            testHtml += '<div style="font-size:10px;color:var(--text-muted);margin-top:4px;">🔒=需在百炼控制台开通 · ✅=可用 · ❓=模型名可能不识别</div>';
            testHtml += '</div>';

            resultDiv.innerHTML = testHtml;
            btn.textContent = '🔄 重新检测';
            
            // 刷新顶部的模型显示（检测结果已持久化到后端）
            loadConfigForBadge();
        } catch (e) {
            resultDiv.innerHTML = '<span style="color:var(--danger);">检测出错：' + e.message + '</span>';
        }
        
        btn.disabled = false;
        btn.style.opacity = '1';
    }

    async function loadHistory(page = 1) {
        historyPage = page;
        const list = document.getElementById('historyList');
        const batchBar = document.getElementById('batchBar');
        // 清理旧的返回按钮
        cleanupHistoryBackBtn();
        // 恢复搜索栏和分页栏显示
        document.getElementById('historySearch').parentElement.style.display = '';
        document.getElementById('historyPagination').style.display = '';
        // 确保显示列表容器和批量栏
        list.style.display = '';
        batchBar.classList.remove('hidden');
        
        // 如果从学生档案进入，显示筛选标签和返回档案按钮
        const profileTag = document.getElementById('profileFilterTag');
        const profileBtn = document.getElementById('btnProfileBack');
        if (historyFromProfile) {
            profileTag.textContent = '筛选学生：' + historyFromProfile;
            profileTag.classList.remove('hidden');
            profileBtn.classList.remove('hidden');
        } else {
            profileTag.textContent = '';
            profileTag.classList.add('hidden');
            profileBtn.classList.add('hidden');
        }
        
        list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">加载中...</div>';

        let url = 'api.php?action=get_history&page=' + page;
        if (historySearchTerm) url += '&search=' + encodeURIComponent(historySearchTerm);
        if (historyStudentFilter) url += '&student=' + encodeURIComponent(historyStudentFilter);

        try {
            const resp = await fetch(url);
            const result = await resp.json();
            if (result.success) {
                historyTotalPages = result.totalPages || 1;
                
                if (result.data.length === 0) {
                    let msg = '暂无历史记录';
                    if (historyStudentFilter) {
                        msg = '「' + escapeHtml(historyStudentFilter) + '」暂无反馈记录';
                    } else if (historySearchTerm) {
                        msg = '没有匹配「' + escapeHtml(historySearchTerm) + '」的记录';
                    }
                    list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">' + msg + '<br><span style="font-size:12px;">生成反馈后会自动保存到这里</span></div>';
                    batchBar.classList.add('hidden');
                } else {
                    list.innerHTML = result.data.map(item => {
                        const studentName = item.student_name || '未填写';
                        const studentLevel = item.student_level || '';
                        const studentGrade = item.student_grade || '';
                        const levelBadge = studentLevel ? ` <span style="font-size:10px;background:${studentLevel === '优秀' ? '#ECFDF5' : studentLevel === '良好' ? '#EFF6FF' : studentLevel === '薄弱' ? '#FEF2F2' : '#FFFBEB'};color:${studentLevel === '优秀' ? '#059669' : studentLevel === '良好' ? '#2563EB' : studentLevel === '薄弱' ? '#DC2626' : '#D97706'};padding:1px 6px;border-radius:8px;font-weight:600;">${escapeHtml(studentLevel)}</span>` : '';
                        const gradeBadge = studentGrade ? ` <span style="font-size:10px;background:#F0F9FF;color:#0369A1;padding:1px 6px;border-radius:8px;font-weight:600;">📚${escapeHtml(studentGrade)}</span>` : '';
                        const contentPreview = item.teaching_content_preview || item.teaching_content || '流式生成';
                        const model = item.model_used || 'stream';
                        const tokenStr = (item.total_tokens > 0) ? ' · 🎫' + item.total_tokens + 't' : ' · 🎫0t（流式生成，API未返回token数据）';
                        // 格式化时间显示
                        const timeStr = item.created_at || '';
                        const timeDisplay = timeStr.length > 10 ? timeStr.substring(0, 10) : timeStr;
                        const checked = selectedHistoryIds.has(item.id) ? ' checked' : '';
                        return `
                        <div class="history-item${selectModeActive ? ' select-mode' : ''}" data-id="${item.id}" onclick="${selectModeActive ? "toggleHistorySelect(" + item.id + ", event)" : "viewHistory(" + item.id + ")"}">
                            <input type="checkbox" class="history-checkbox" id="cb-${item.id}" ${checked} onclick="event.stopPropagation();toggleHistorySelect(${item.id}, event)" style="${selectModeActive ? '' : 'display:none;'}">
                            <div class="hi-info" onclick="${selectModeActive ? "event.stopPropagation();toggleHistorySelect(" + item.id + ", event)" : ""}">
                                <div class="hi-content" style="font-weight:600;">👤 ${escapeHtml(studentName)}${levelBadge}${gradeBadge} <span style="font-weight:400;color:var(--text-secondary);">· ${escapeHtml(contentPreview)}</span></div>
                                <div class="hi-meta">
                                    <span>📅 ${timeDisplay}</span>
                                    <span>${model}${tokenStr}</span>
                                </div>
                            </div>
                            <button class="hi-delete" onclick="event.stopPropagation();deleteHistory(${item.id})" style="${selectModeActive ? 'display:none;' : ''}">删除</button>
                        </div>
                    `;
                    }).join('');
                    updateBatchBar();
                }
                renderPagination();
            } else {
                list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger);">加载失败：' + escapeHtml(result.message || '未知错误') + '<br><button class="btn btn-ghost btn-sm" onclick="loadHistory(' + page + ')" style="margin-top:8px;">重试</button></div>';
            }
        } catch (e) {
            console.error('加载历史记录失败:', e);
            list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger);">加载失败<br><span style="font-size:12px;color:var(--text-muted);">' + escapeHtml(e.message || '网络错误') + '</span><br><button class="btn btn-ghost btn-sm" onclick="loadHistory(' + page + ')" style="margin-top:8px;">重试</button></div>';
        }
    }

    function renderPagination() {
        const pagination = document.getElementById('historyPagination');
        if (historyTotalPages <= 1) {
            pagination.innerHTML = '';
            return;
        }

        let html = '';
        // 上一页
        html += '<button class="btn btn-ghost btn-sm" ' + (historyPage <= 1 ? 'disabled' : 'onclick="loadHistory(' + (historyPage - 1) + ')"') + ' style="font-size:11px;">← 上一页</button>';
        
        // 页码
        const maxButtons = 7;
        let startPage = Math.max(1, historyPage - 3);
        let endPage = Math.min(historyTotalPages, startPage + maxButtons - 1);
        if (endPage - startPage < maxButtons - 1) {
            startPage = Math.max(1, endPage - maxButtons + 1);
        }

        if (startPage > 1) {
            html += '<button class="btn btn-ghost btn-sm" onclick="loadHistory(1)" style="font-size:11px;">1</button>';
            if (startPage > 2) html += '<span style="padding:0 4px;">...</span>';
        }

        for (let i = startPage; i <= endPage; i++) {
            if (i === historyPage) {
                html += '<span style="padding:4px 10px;background:var(--primary);color:white;border-radius:4px;font-weight:700;">' + i + '</span>';
            } else {
                html += '<button class="btn btn-ghost btn-sm" onclick="loadHistory(' + i + ')" style="font-size:11px;">' + i + '</button>';
            }
        }

        if (endPage < historyTotalPages) {
            if (endPage < historyTotalPages - 1) html += '<span style="padding:0 4px;">...</span>';
            html += '<button class="btn btn-ghost btn-sm" onclick="loadHistory(' + historyTotalPages + ')" style="font-size:11px;">' + historyTotalPages + '</button>';
        }

        // 下一页
        html += '<button class="btn btn-ghost btn-sm" ' + (historyPage >= historyTotalPages ? 'disabled' : 'onclick="loadHistory(' + (historyPage + 1) + ')"') + ' style="font-size:11px;">下一页 →</button>';

        // 总数
        html += '<span style="margin-left:8px;font-size:11px;">共 ' + historyTotalPages + ' 页</span>';

        pagination.innerHTML = html;
    }

    function searchHistory() {
        historySearchTerm = document.getElementById('historySearch').value.trim();
        if (historySearchTerm) {
            historyStudentFilter = '';
            // 搜索时暂时隐藏档案筛选标签（但仍保留返回按钮）
            const profileTag = document.getElementById('profileFilterTag');
            if (profileTag) profileTag.classList.add('hidden');
        }
        historyPage = 1;
        loadHistory(1);
    }

    function clearHistorySearch() {
        document.getElementById('historySearch').value = '';
        historySearchTerm = '';
        if (!historyFromProfile) {
            historyStudentFilter = '';
        } else {
            // 恢复档案筛选
            historyStudentFilter = historyFromProfile;
            const profileTag = document.getElementById('profileFilterTag');
            if (profileTag) {
                profileTag.textContent = '筛选学生：' + historyFromProfile;
                profileTag.classList.remove('hidden');
            }
        }
        historyPage = 1;
        loadHistory(1);
    }

    async function viewHistory(id) {
        // 进入详情时隐藏搜索栏、批量操作栏和分页栏
        document.getElementById('batchBar').classList.add('hidden');
        document.getElementById('historySearch').parentElement.style.display = 'none';
        document.getElementById('historyPagination').style.display = 'none';
        
        const isFromProfile = !!historyFromProfile;
        try {
            const resp = await fetch('api.php?action=get_history&detail=' + id);
            const result = await resp.json();
            if (result.success && result.data) {
                // 使用公共渲染函数
                const html = renderFeedbackDetail(result.data);
                
                const list = document.getElementById('historyList');
                list.innerHTML = html;
                
                // 在 wrapper 顶部添加返回按钮
                const wrapper = document.getElementById('historyListWrapper');
                const backBtn = document.createElement('div');
                backBtn.dataset.isBackBtn = '1';
                backBtn.style.cssText = 'padding:10px 20px;border-bottom:1px solid var(--border);flex-shrink:0;display:flex;gap:8px;align-items:center;';
                backBtn.innerHTML = '<button class="btn btn-outline btn-sm" style="color:var(--text);border-color:var(--border);">← 返回列表</button>';
                
                if (isFromProfile) {
                    backBtn.innerHTML += '<button class="btn btn-ghost btn-sm" style="color:var(--primary);font-size:11px;">👥 返回学生档案</button>';
                    backBtn.querySelectorAll('button')[1].onclick = goBackToStudentProfile;
                }
                backBtn.querySelector('button').onclick = loadHistory;
                wrapper.insertBefore(backBtn, wrapper.firstChild);
                document.getElementById('historyList')._backBtn = backBtn;
            } else {
                showToast('获取记录详情失败：' + (result.message || '记录可能已被删除'), 'error');
                loadHistory();
            }
        } catch (e) {
            showToast('网络错误，获取详情失败：' + e.message, 'error');
            loadHistory();
        }
    }

    function cleanupHistoryBackBtn() {
        const wrapper = document.getElementById('historyListWrapper');
        // 通过 data 属性标记识别返回按钮
        if (wrapper && wrapper.firstChild && wrapper.firstChild.dataset && wrapper.firstChild.dataset.isBackBtn === '1') {
            wrapper.firstChild.remove();
        }
        // 兼容旧的 _backBtn 引用
        const list = document.getElementById('historyList');
        if (list && list._backBtn) {
            list._backBtn.remove();
            list._backBtn = null;
        }
    }

    // 增强 closeHistoryModal：关闭时自动清理返回按钮和档案筛选状态
    const origCloseHistory = closeHistoryModalImpl;
    closeHistoryModalImpl = function() {
        cleanupHistoryBackBtn();
        // 清除档案筛选UI状态
        const profileTag = document.getElementById('profileFilterTag');
        const profileBtn = document.getElementById('btnProfileBack');
        if (profileTag) { profileTag.textContent = ''; profileTag.classList.add('hidden'); }
        if (profileBtn) profileBtn.classList.add('hidden');
        historyFromProfile = '';
        historyStudentFilter = '';
        origCloseHistory();
    };

    async function deleteHistory(id) {
        if (!confirm('确定删除这条反馈记录吗？')) return;
        try {
            const resp = await fetch('api.php?action=delete_history', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: id })
            });
            const result = await resp.json();
            if (result.success) {
                showToast('删除成功', 'success');
                // 从选中集合中移除
                selectedHistoryIds.delete(id);
                loadHistory();
            }
        } catch (e) {
            showToast('删除失败', 'error');
        }
    }

    // ============ 批量选择功能 ============
    function toggleHistorySelect(id, event) {
        // 确保进入选择模式
        if (!selectModeActive) {
            selectModeActive = true;
        }

        if (selectedHistoryIds.has(id)) {
            selectedHistoryIds.delete(id);
        } else {
            selectedHistoryIds.add(id);
        }

        // 更新checkbox状态
        const cb = document.getElementById('cb-' + id);
        if (cb) cb.checked = selectedHistoryIds.has(id);

        updateBatchBar();
        // 刷新列表以应用选择模式样式
        if (selectedHistoryIds.size === 0) {
            selectModeActive = false;
            refreshHistoryItems();
        } else {
            refreshHistoryItems();
        }
    }

    function toggleSelectAll() {
        const allCb = document.getElementById('selectAllCheckbox');
        const checked = allCb.checked;

        if (checked) {
            selectModeActive = true;
            // 全选当前列表中所有记录
            const items = document.querySelectorAll('#historyList .history-item');
            items.forEach(item => {
                const id = parseInt(item.getAttribute('data-id'));
                if (id > 0) selectedHistoryIds.add(id);
            });
        } else {
            selectedHistoryIds.clear();
            selectModeActive = false;
        }

        refreshHistoryItems();
        updateBatchBar();
    }

    function cancelSelectMode() {
        selectedHistoryIds.clear();
        selectModeActive = false;
        document.getElementById('selectAllCheckbox').checked = false;
        updateBatchBar();
        refreshHistoryItems();
    }

    function refreshHistoryItems() {
        // 更新checkbox显示状态
        const items = document.querySelectorAll('#historyList .history-item');
        items.forEach(item => {
            const id = parseInt(item.getAttribute('data-id'));
            if (!id) return;
            const cb = item.querySelector('.history-checkbox');
            const delBtn = item.querySelector('.hi-delete');
            const hiInfo = item.querySelector('.hi-info');

            if (selectModeActive) {
                item.classList.add('select-mode');
                if (cb) cb.style.display = '';
                if (cb) cb.checked = selectedHistoryIds.has(id);
                if (delBtn) delBtn.style.display = 'none';
                // 点击整个item切换选中
                item.onclick = function(e) { toggleHistorySelect(id, e); };
                if (hiInfo) hiInfo.setAttribute('onclick', "event.stopPropagation();toggleHistorySelect(" + id + ", event)");
            } else {
                item.classList.remove('select-mode');
                if (cb) cb.style.display = 'none';
                if (cb) cb.checked = false;
                if (delBtn) delBtn.style.display = '';
                // 恢复点击查看详情
                item.onclick = function() { viewHistory(id); };
                if (hiInfo) hiInfo.removeAttribute('onclick');
            }
        });

        // 更新全选checkbox
        const allCb = document.getElementById('selectAllCheckbox');
        const totalItems = items.length;
        const selectedItems = selectedHistoryIds.size;
        if (totalItems > 0 && selectedItems >= totalItems) {
            allCb.checked = true;
            allCb.indeterminate = false;
        } else if (selectedItems > 0) {
            allCb.checked = false;
            allCb.indeterminate = true;
        } else {
            allCb.checked = false;
            allCb.indeterminate = false;
        }
    }

    function updateBatchBar() {
        const count = selectedHistoryIds.size;
        const batchBar = document.getElementById('batchBar');
        const countEl = document.getElementById('selectedCount');
        const btnEl = document.getElementById('btnBatchDelete');
        if (countEl) countEl.textContent = '已选 ' + count + ' 条';
        if (btnEl) btnEl.disabled = count === 0;

        if (!selectModeActive && count === 0) {
            // 默认也显示批量栏，让用户可以长按进入选择模式
            // 保持显示
        }
    }

    async function batchDeleteHistory() {
        if (selectedHistoryIds.size === 0) return;
        if (!confirm('确定删除选中的 ' + selectedHistoryIds.size + ' 条反馈记录吗？\n\n此操作不可恢复！')) return;

        const btn = document.getElementById('btnBatchDelete');
        btn.disabled = true;
        btn.textContent = '⏳ 删除中...';

        try {
            const resp = await fetch('api.php?action=delete_history_batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: Array.from(selectedHistoryIds) })
            });
            const result = await resp.json();
            if (result.success) {
                showToast(result.message || '批量删除成功', 'success');
                selectedHistoryIds.clear();
                selectModeActive = false;
                document.getElementById('selectAllCheckbox').checked = false;
                updateBatchBar();
                loadHistory();
            } else {
                showToast(result.message || '批量删除失败', 'error');
            }
        } catch (e) {
            showToast('批量删除失败：' + e.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = '🗑 批量删除';
        }
    }

    // ============ 学生档案 ============
    function openStudentProfileModal() {
        document.getElementById('studentProfileModal').classList.remove('hidden');
        loadStudentProfiles();
    }

    function closeStudentProfileModal() {
        // 清理档案弹窗内的历史记录状态
        const list = document.getElementById('studentProfileList');
        const backBar = document.getElementById('profileHistoryBackBar');
        if (backBar) backBar.remove();
        if (list) {
            delete list._profileListBackup;
            delete list._profileDetailBackup;
        }
        // 恢复标题
        const header = document.querySelector('#studentProfileModal .modal-header h3');
        if (header) header.textContent = '👥 学生档案';
        historyFromProfile = '';
        historyStudentFilter = '';
        document.getElementById('studentProfileModal').classList.add('hidden');
    }

    async function loadStudentProfiles() {
        const list = document.getElementById('studentProfileList');
        list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">加载中...</div>';

        try {
            const resp = await fetch('api.php?action=student_profile');
            const result = await resp.json();
            if (result.success) {
                if (result.data.length === 0) {
                    list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">暂无学生档案<br><span style="font-size:12px;">生成反馈后会自动建立档案</span></div>';
                } else {
                    list.innerHTML = result.data.map((student, index) => {
                        const lastTime = student.last_feedback_time || '';
                        const firstTime = student.first_feedback_time || '';
                        const tokenStr = (student.total_tokens || 0) > 0 ? (student.total_tokens || 0).toLocaleString() + ' tokens' : '';
                        const colors = ['#4F46E5','#059669','#D97706','#DC2626','#7C3AED','#0891B2'];
                        const color = colors[index % colors.length];
                        const studentLevel = student.student_level || '';
                        const studentGrade = student.student_grade || '';
                        const trendScore = student.trend_score || 0;
                        const lvlColors = { '优秀': '#059669', '良好': '#2563EB', '中等': '#D97706', '薄弱': '#DC2626' };
                        const lvlBgColors = { '优秀': '#ECFDF5', '良好': '#EFF6FF', '中等': '#FFFBEB', '薄弱': '#FEF2F2' };
                        const levelBadge = studentLevel ? ' <span style="font-size:10px;background:' + (lvlBgColors[studentLevel] || '#F3F4F6') + ';color:' + (lvlColors[studentLevel] || '#6B7280') + ';padding:1px 6px;border-radius:8px;font-weight:600;margin-left:4px;">' + escapeHtml(studentLevel) + '</span>' : '';
                        const gradeBadge = studentGrade ? ' <span style="font-size:10px;background:#F0F9FF;color:#0369A1;padding:1px 6px;border-radius:8px;font-weight:600;margin-left:4px;">📚' + escapeHtml(studentGrade) + '</span>' : '';
                        // 趋势分数：绿色=积极，黄色=中等，红色=需关注
                        const trendColor = trendScore >= 70 ? '#059669' : trendScore >= 40 ? '#D97706' : '#DC2626';
                        const trendBg = trendScore >= 70 ? '#ECFDF5' : trendScore >= 40 ? '#FFFBEB' : '#FEF2F2';
                        const trendEmoji = trendScore >= 70 ? '📈' : trendScore >= 40 ? '📊' : '📉';
                        const trendLabel = trendScore >= 70 ? '积极' : trendScore >= 40 ? '一般' : '需关注';
                        const trendBadge = student.feedback_count >= 2 
                            ? ` <span style="font-size:10px;background:${trendBg};color:${trendColor};padding:1px 6px;border-radius:8px;font-weight:600;">${trendEmoji}${trendLabel}</span>`
                            : '';
                        const timeRange = firstTime ? ' · ' + firstTime.substring(0, 10) + ' ~ ' + lastTime.substring(0, 10) : '';
                        return `
                        <div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:14px;cursor:pointer;transition:background 0.15s;" 
                             onclick="viewStudentHistory('${escapeHtml(student.student_name)}')"
                             onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">
                            <div style="width:42px;height:42px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;color:white;font-size:16px;font-weight:700;flex-shrink:0;">
                                ${escapeHtml(student.student_name).charAt(0)}
                            </div>
                            <div style="flex:1;min-width:0;">
                                <div style="font-size:14px;font-weight:700;color:var(--text);">${escapeHtml(student.student_name)}${levelBadge}${gradeBadge}${trendBadge}</div>
                                <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">
                                    反馈 ${student.feedback_count} 次 · ${tokenStr} · 最近 ${lastTime.substring(0, 10)}
                                    ${student.feedback_count >= 2 ? '<br><span style="font-size:10px;">' + timeRange + '</span>' : ''}
                                </div>
                            </div>
                            <span style="font-size:12px;color:var(--text-muted);flex-shrink:0;">查看详情 →</span>
                        </div>
                    `;
                    }).join('');
                }
            }
        } catch (e) {
            console.error('加载学生档案失败:', e);
            list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger);">加载失败<br><span style="font-size:12px;color:var(--text-muted);">' + escapeHtml(e.message || '网络错误') + '</span><br><button class="btn btn-ghost btn-sm" onclick="loadStudentProfiles()" style="margin-top:8px;">重试</button></div>';
        }
    }

    async function viewStudentHistory(studentName) {
        // 在学生档案弹窗内直接展示该学生的历史记录（不跳转弹窗）
        const wrapper = document.getElementById('studentProfileWrapper');
        const list = document.getElementById('studentProfileList');
        
        // 保存当前档案列表HTML以便返回
        if (!list._profileListBackup) {
            list._profileListBackup = list.innerHTML;
        }
        
        // 显示返回按钮
        let backBar = document.getElementById('profileHistoryBackBar');
        if (!backBar) {
            backBar = document.createElement('div');
            backBar.id = 'profileHistoryBackBar';
            backBar.style.cssText = 'padding:8px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;flex-shrink:0;';
            backBar.innerHTML = '<button class="btn btn-outline btn-sm" style="color:var(--text);border-color:var(--border);">← 返回学生列表</button>' +
                '<span style="font-size:12px;color:var(--primary);font-weight:600;">筛选学生：' + escapeHtml(studentName) + '</span>';
            backBar.querySelector('button').onclick = function() {
                // 恢复学生档案列表
                if (list._profileListBackup) {
                    list.innerHTML = list._profileListBackup;
                    delete list._profileListBackup;
                }
                backBar.remove();
                document.getElementById('studentProfileList').style.display = '';
                // 恢复 modal header
                const header = document.querySelector('#studentProfileModal .modal-header h3');
                if (header) header.textContent = '👥 学生档案';
            };
            wrapper.insertBefore(backBar, wrapper.firstChild);
        }
        
        // 修改弹窗标题
        const header = document.querySelector('#studentProfileModal .modal-header h3');
        if (header) header.textContent = '📋 ' + escapeHtml(studentName) + ' 的历史反馈';
        
        // 加载该学生的历史记录到档案弹窗内
        list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">加载中...</div>';
        
        historyFromProfile = studentName;
        historyStudentFilter = studentName;
        historyPage = 1;
        
        try {
            const url = 'api.php?action=get_history&page=1&student=' + encodeURIComponent(studentName);
            const resp = await fetch(url);
            const result = await resp.json();
            if (result.success) {
                if (result.data.length === 0) {
                    list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">「' + escapeHtml(studentName) + '」暂无反馈记录</div>';
                } else {
                    list.innerHTML = result.data.map(item => {
                        const studentLevel = item.student_level || '';
                        const studentGrade = item.student_grade || '';
                        const lvlColors = { '优秀': '#059669', '良好': '#2563EB', '中等': '#D97706', '薄弱': '#DC2626' };
                        const lvlBgColors = { '优秀': '#ECFDF5', '良好': '#EFF6FF', '中等': '#FFFBEB', '薄弱': '#FEF2F2' };
                        const levelBadge = studentLevel ? ' <span style="font-size:10px;background:' + (lvlBgColors[studentLevel] || '#F3F4F6') + ';color:' + (lvlColors[studentLevel] || '#6B7280') + ';padding:1px 6px;border-radius:8px;font-weight:600;">' + escapeHtml(studentLevel) + '</span>' : '';
                        const gradeBadge = studentGrade ? ' <span style="font-size:10px;background:#F0F9FF;color:#0369A1;padding:1px 6px;border-radius:8px;font-weight:600;">📚' + escapeHtml(studentGrade) + '</span>' : '';
                        const contentPreview = item.teaching_content_preview || item.teaching_content || '流式生成';
                        const model = item.model_used || 'stream';
                        const tokenStr = (item.total_tokens > 0) ? ' · 🎫' + item.total_tokens + 't' : '';
                        const timeStr = item.created_at || '';
                        const timeDisplay = timeStr.length > 10 ? timeStr.substring(0, 10) : timeStr;
                        return `
                        <div class="history-item" onclick="viewHistoryInProfile(${item.id})" style="cursor:pointer;">
                            <div class="hi-info">
                                <div class="hi-content">📖 ${escapeHtml(contentPreview)}${levelBadge}${gradeBadge}</div>
                                <div class="hi-meta">
                                    <span>📅 ${timeDisplay}</span>
                                    <span>${model}${tokenStr}</span>
                                </div>
                            </div>
                        </div>
                    `;
                    }).join('');
                }
            } else {
                list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger);">加载失败：' + escapeHtml(result.message || '未知错误') + '<br><button class="btn btn-ghost btn-sm" onclick="viewStudentHistory(\'' + escapeHtml(studentName) + '\')" style="margin-top:8px;">重试</button></div>';
            }
        } catch (e) {
            console.error('加载学生历史失败:', e);
            list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger);">加载失败<br><span style="font-size:12px;color:var(--text-muted);">' + escapeHtml(e.message || '网络错误') + '</span><br><button class="btn btn-ghost btn-sm" onclick="viewStudentHistory(\'' + escapeHtml(studentName) + '\')" style="margin-top:8px;">重试</button></div>';
        }
    }

    // 在学生档案弹窗内查看历史详情
    async function viewHistoryInProfile(id) {
        const list = document.getElementById('studentProfileList');
        const backBar = document.getElementById('profileHistoryBackBar');
        
        if (!list._profileDetailBackup) {
            list._profileDetailBackup = list.innerHTML;
        }
        
        if (backBar) {
            const btn = backBar.querySelector('button');
            const label = backBar.querySelector('span');
            if (label) label.textContent = '查看详情';
            if (btn) {
                btn.textContent = '← 返回列表';
                btn.onclick = function() {
                    if (list._profileDetailBackup) {
                        list.innerHTML = list._profileDetailBackup;
                        delete list._profileDetailBackup;
                    }
                    if (label) label.textContent = '筛选学生：' + escapeHtml(historyFromProfile || '');
                    btn.textContent = '← 返回学生列表';
                    btn.onclick = function() {
                        if (list._profileListBackup) {
                            list.innerHTML = list._profileListBackup;
                            delete list._profileListBackup;
                        }
                        backBar.remove();
                        list.style.display = '';
                        const header = document.querySelector('#studentProfileModal .modal-header h3');
                        if (header) header.textContent = '👥 学生档案';
                        historyFromProfile = '';
                        historyStudentFilter = '';
                    };
                };
            }
        }
        
        try {
            const resp = await fetch('api.php?action=get_history&detail=' + id);
            const result = await resp.json();
            if (result.success && result.data) {
                // 使用公共渲染函数
                let html = '<div style="padding:16px;">';
                html += renderFeedbackDetail(result.data);
                html += '</div>';
                list.innerHTML = html;
            } else {
                list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger);">获取详情失败</div>';
            }
        } catch (e) {
            list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger);">网络错误：' + escapeHtml(e.message || '') + '</div>';
        }
    }

    function goBackToStudentProfile() {
        // 从历史弹窗返回学生档案
        historyFromProfile = '';
        historyStudentFilter = '';
        historySearchTerm = '';
        document.getElementById('historySearch').value = '';
        document.getElementById('historyModal').classList.add('hidden');
        openStudentProfileModal();
    }

    async function filterHistoryByStudent(studentName) {
        historySearchTerm = '';
        historyStudentFilter = studentName;
        document.getElementById('historySearch').value = studentName;
        historyPage = 1;
        loadHistory(1);
        // loadHistory 内部会根据 historyFromProfile 自动显示筛选标签和返回按钮
        document.getElementById('batchBar').classList.remove('hidden');
    }
    // showToast 已在 utils.js 中定义

    // ============ Modal点击遮罩关闭 ============
    document.getElementById('configModal').addEventListener('click', function(e) {
        if (e.target === this) closeConfigModal();
    });
    document.getElementById('diagnoseModal').addEventListener('click', function(e) {
        if (e.target === this) closeDiagnoseModal();
    });
    document.getElementById('historyModal').addEventListener('click', function(e) {
        if (e.target === this) closeHistoryModal();
    });
    document.getElementById('studentProfileModal').addEventListener('click', function(e) {
        if (e.target === this) closeStudentProfileModal();
    });
    document.getElementById('shareModal').addEventListener('click', function(e) {
        if (e.target === this) closeShareModal();
    });

    // ============ Token统计（诊断弹窗中） ============
    async function loadTokenStatsInDiagnoseAsync() {
        try {
            const resp = await fetch('api.php?action=token_stats');
            const result = await resp.json();
            if (result.success && result.data) {
                const d = result.data;
                const totals = d.totals || {};
                const totalAll = totals.total_all || 0;
                const totalPrompt = totals.total_prompt || 0;
                const totalCompletion = totals.total_completion || 0;
                
                const promptPercent = totalAll > 0 ? Math.round(totalPrompt / totalAll * 100) : 0;
                const completionPercent = totalAll > 0 ? Math.round(totalCompletion / totalAll * 100) : 0;
                
                let statsHtml = '<div style="margin-top:16px;padding:16px;background:var(--bg);border-radius:var(--radius-sm);">';
                statsHtml += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">';
                statsHtml += '<strong style="font-size:14px;">🎫 Token 使用统计</strong>';
                if (totalAll > 0) {
                    statsHtml += '<span style="font-size:11px;color:var(--text-muted);">累计 ' + (totals.total_generations || 0) + ' 次生成</span>';
                }
                statsHtml += '</div>';
                
                statsHtml += '<div style="text-align:center;padding:16px 0;background:white;border-radius:var(--radius-sm);border:1px solid var(--border);margin-bottom:10px;">';
                statsHtml += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">累计消耗</div>';
                statsHtml += '<div style="font-size:28px;font-weight:800;color:var(--primary);font-family:monospace;">' + totalAll.toLocaleString() + '</div>';
                statsHtml += '<div style="font-size:11px;color:var(--text-muted);">tokens</div>';
                statsHtml += '</div>';
                
                if (totalAll > 0) {
                    statsHtml += '<div style="margin-bottom:10px;">';
                    statsHtml += '<div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px;">';
                    statsHtml += '<span style="color:var(--text-secondary);">📥 输入 ' + totalPrompt.toLocaleString() + ' (' + promptPercent + '%)</span>';
                    statsHtml += '<span style="color:var(--text-secondary);">📤 输出 ' + totalCompletion.toLocaleString() + ' (' + completionPercent + '%)</span>';
                    statsHtml += '</div>';
                    statsHtml += '<div style="height:6px;background:#E2E8F0;border-radius:3px;overflow:hidden;display:flex;">';
                    statsHtml += '<div style="width:' + promptPercent + '%;background:linear-gradient(90deg,#818CF8,#4F46E5);border-radius:3px 0 0 3px;"></div>';
                    statsHtml += '<div style="width:' + completionPercent + '%;background:linear-gradient(90deg,#34D399,#059669);border-radius:0 3px 3px 0;"></div>';
                    statsHtml += '</div>';
                    statsHtml += '</div>';
                }
                
                if (d.by_model && d.by_model.length > 0) {
                    statsHtml += '<div style="margin-top:10px;font-size:11px;color:var(--text-muted);">';
                    statsHtml += '<div style="font-weight:600;color:var(--text-secondary);margin-bottom:4px;">按模型统计</div>';
                    d.by_model.forEach(m => {
                        const tokenDisplay = (m.total_all || 0) > 0 ? (m.total_all || 0).toLocaleString() + ' tokens' : '0 tokens（估算值）';
                        statsHtml += '<div style="display:flex;align-items:center;padding:4px 0;border-bottom:1px solid #F1F5F9;">';
                        statsHtml += '<span style="flex:1;">· <b>' + (m.model_used || 'stream') + '</b></span>';
                        statsHtml += '<span style="color:var(--text-secondary);">' + m.count + '次 · ' + tokenDisplay + '</span>';
                        statsHtml += '</div>';
                    });
                    statsHtml += '</div>';
                }

                if (d.recent && d.recent.length > 0) {
                    statsHtml += '<div style="margin-top:10px;font-size:11px;">';
                    statsHtml += '<span style="color:var(--text-muted);">最近消耗：</span>';
                    let hasRecent = false;
                    d.recent.slice(0, 5).forEach(r => {
                        if (r.total_tokens > 0) {
                            hasRecent = true;
                            statsHtml += '<span style="display:inline-block;background:white;padding:2px 8px;border-radius:4px;margin:2px 4px 2px 0;border:1px solid var(--border);">' + (r.total_tokens || 0) + 't</span>';
                        }
                    });
                    if (!hasRecent) {
                        statsHtml += '<span style="color:var(--text-muted);">暂无记录</span>';
                    }
                    statsHtml += '</div>';
                }

                statsHtml += '</div>';
                return statsHtml;
            }
        } catch (e) { /* 静默处理 */ }
        return '';
    }
    function loadTokenStatsInDiagnose() { /* 已迁移到 Async 版本 */ }

    async function loadQuotaInDiagnoseAsync() {
        try {
            const resp = await fetch('api.php?action=quota_info');
            const result = await resp.json();
            if (result.success && result.data) {
                const d = result.data;
                let quotaHtml = '<div style="margin-top:16px;padding:12px;background:var(--bg);border-radius:var(--radius-sm);">';
                quotaHtml += '<strong>💰 账户配额信息</strong><br>';

                if (d.quota && d.source === 'dashscope_usage_api') {
                    quotaHtml += '<div style="font-size:12px;color:var(--text-muted);margin-top:4px;">';
                    quotaHtml += '近30天用量数据已获取，详情请查看原始数据。<br>';
                    quotaHtml += '<pre style="font-size:10px;background:white;padding:8px;border-radius:4px;overflow:auto;max-height:150px;">' + JSON.stringify(d.quota, null, 2) + '</pre>';
                    quotaHtml += '</div>';
                } else if (d.local_usage) {
                    const lu = d.local_usage;
                    quotaHtml += '<div style="font-size:12px;margin-top:4px;">';
                    quotaHtml += '<span style="color:var(--text-muted);">📊 本系统统计：累计生成 <b>' + (lu.total_generations || 0) + '</b> 次，共消耗 <b style="color:var(--primary);">' + (lu.total_tokens || 0).toLocaleString() + '</b> tokens</span><br>';
                    quotaHtml += '<span style="color:var(--text-muted);font-size:11px;">⚠️ 千问API不直接提供余额查询接口，请登录 <a href="https://dashscope.console.aliyun.com/overview" target="_blank" style="color:var(--primary);">阿里云百炼控制台</a> 查看账户余额</span>';
                    quotaHtml += '</div>';
                } else {
                    quotaHtml += '<span style="color:var(--text-muted);font-size:12px;">暂无数据</span>';
                }

                quotaHtml += '</div>';
                return quotaHtml;
            }
        } catch (e) { /* 静默处理 */ }
        return '';
    }
    function loadQuotaInDiagnose() { /* 已迁移到 Async 版本 */ }

    // ============ 键盘快捷键 ============
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeConfigModal();
            closeDiagnoseModal();
            closeHistoryModal();
            closeStudentProfileModal();
            closeShareModal();
        }
        // Ctrl/Cmd + Enter 生成反馈
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            generateFeedback();
        }
    });

    // ============ 页面初始化 ============
    (function init() {
        // 脚本在body底部加载，DOM已就绪，直接渲染
        renderDimensions();
        // 初始化日期选择器
        initDateSelectors();

        // 设置温度滑块联动
        const tempSlider = document.getElementById('temperature');
        const tempValue = document.getElementById('tempValue');
        if (tempSlider && tempValue) {
            tempSlider.addEventListener('input', function() {
                tempValue.textContent = parseFloat(this.value).toFixed(1);
            });
        }

        // 恢复已保存的配置（模型badge显示）
        loadConfigForBadge();
    })();

    async function loadConfigForBadge() {
        try {
            const resp = await fetch('api.php?action=get_config');
            const result = await resp.json();
            if (result.success) {
                const model = (result.data && result.data.model) ? result.data.model : '';
                const check = result.model_check || null;
                
                let badgeText = '';
                if (check && check.total > 0) {
                    // 构建检测摘要：共检测 8 个模型，可用 7 个，1 个需开通权限 · 当前使用：qwen-max · 6/8 02:02
                    const timeStr = check.checked_at ? formatCheckTime(check.checked_at) : '';
                    badgeText = '共检测 <b>' + check.total + '</b> 个模型，可用 <b>' + check.available + '</b> 个';
                    if (check.forbidden > 0) {
                        badgeText += '，<b style="color:#DC2626;">' + check.forbidden + '</b> 个需开通权限';
                    }
                    if (model) {
                        badgeText += ' · 当前使用：<b>' + model + '</b>';
                    }
                    if (timeStr) {
                        badgeText += ' · ' + timeStr;
                    }
                } else if (model) {
                    badgeText = '当前模型：' + model;
                }
                document.getElementById('modelBadge').innerHTML = badgeText;
            }
        } catch (e) {
            // 静默处理
        }
    }
    
    /**
     * 格式化检测时间（如 "2025-06-08 02:02:00" → "6/8 02:02"）
     */
    function formatCheckTime(timeStr) {
        try {
            const d = new Date(timeStr.replace(' ', 'T') + (timeStr.includes('+') || timeStr.includes('Z') ? '' : '+08:00'));
            if (isNaN(d.getTime())) return '';
            return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + 
                   String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        } catch (e) {
            return '';
        }
    }

    /**
     * 反馈质量自检：生成完成后自动检查常见问题
     * @param {string} text - 生成的反馈文本
     */
    function runQualityCheck(text) {
        if (!text) return;
        const warnings = [];
        
        // 1. 检查是否缺少标题（日期 课堂反馈）
        if (!/课堂反馈/.test(text) || !/^\d+\.\d+/.test(text)) {
            warnings.push('缺少标题（日期 课堂反馈），请检查生成结果');
        }
        
        // 2. 检查是否使用了禁止的称呼
        const bannedTerms = ['该生', '该同学', '学员'];
        for (const term of bannedTerms) {
            if (text.includes(term)) {
                warnings.push('检测到生硬称呼"' + term + '"，建议改为"孩子"');
            }
        }
        
        // 3. 检查是否缺少三段式结构（授课内容/课堂表现/作业）
        const hasTeaching = /授课内容/.test(text);
        const hasPerformance = /课堂表现/.test(text);
        const hasHomework = /作业/.test(text);
        const missingSections = [];
        if (!hasTeaching) missingSections.push('授课内容');
        if (!hasPerformance) missingSections.push('课堂表现');
        if (!hasHomework) missingSections.push('作业');
        if (missingSections.length > 0) {
            warnings.push('缺少段落：' + missingSections.join('、') + '，请检查生成结果');
        }
        
        // 4. 检查是否过度夸张
        const exaggerations = ['极其出色', '天赋异禀', '无与伦比'];
        for (const w of exaggerations) {
            if (text.includes(w)) {
                warnings.push('检测到过度夸张词汇"' + w + '"');
            }
        }
        
        // 5. 检查是否使用了过度亲切/卖萌的语气表达
        const overFamiliarPatterns = ['真是让人高兴呢', '不过呢', '不错呢', '真好呢', '真棒呢'];
        for (const w of overFamiliarPatterns) {
            if (text.includes(w)) {
                warnings.push('检测到过度亲切表达"' + w + '"，语气应更客观平实');
            }
        }
        
        // 6. 检查是否使用了负面定性词汇
        const negativeLabels = ['成绩较差', '基础太差', '太笨', '不行'];
        for (const w of negativeLabels) {
            if (text.includes(w)) {
                warnings.push('检测到负面定性词汇"' + w + '"，建议温和表达');
            }
        }
        
        // 7. 检查是否包含疑似编造的具体编号
        const fabricatedPatterns = [
            /第\d+题/g,           // "第8题"
            /P\d+/g,              // "P32"
            /讲义第?\d+页/g,      // "讲义第2页"
            /第\d+页/g,           // "第32页"
        ];
        for (const pattern of fabricatedPatterns) {
            const matches = text.match(pattern);
            if (matches && matches.length > 0) {
                warnings.push('疑似编造了具体编号/页码：' + matches.slice(0, 3).join('、'));
                break;
            }
        }

        // 8. 检查是否提及"举手"（不应编造课堂行为）
        if (/举手/.test(text)) {
            warnings.push('检测到"举手"描述，AI不应编造课堂举手等具体行为');
        }

        // 9. 检查作业部分是否有鼓励语结尾
        const homeworkSection = text.split('作业')[1] || '';
        const encouragementPatterns = [/加油/, /继续努力/, /坚持/, /相信你/, /期待/, /你真棒/, /看好你/];
        for (const pat of encouragementPatterns) {
            if (pat.test(homeworkSection)) {
                warnings.push('作业部分检测到鼓励语，应直接列作业内容');
                break;
            }
        }
        
        // 显示警告（如果有）
        if (warnings.length > 0) {
            const toastMsg = '⚠️ 质量提醒：' + warnings.join('；');
            setTimeout(() => showToast(toastMsg, 'error'), 1500);
        }
    }
