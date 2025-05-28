const inquirer = require('inquirer');
const YAML = require('yaml');
const fs = require('fs-extra');
const path = require('path');
const archiver = require('archiver');
const tar = require('tar');
const dotenv = require('dotenv');
const crypto = require('crypto');
const os = require('os');

const ASCII_LOGO = `
$$\\                                   $$\\   $$\\     $$\\ 
$$ |                                  $$ |  $$ |    $$ |
$$ |$$$$$$$$\\  $$$$$$$\\          $$$$$$$ |$$$$$$\\   $$ |
$$ |\\____$$  |$$  _____|$$$$$$\\ $$  __$$ |\\_$$  _|  $$ |
$$ |  $$$$ _/ $$ /      \\______|$$ /  $$ |  $$ |    $$ |
$$ | $$  _/   $$ |              $$ |  $$ |  $$ |$$\\ $$ |
$$ |$$$$$$$$\\ \\$$$$$$$\\         \\$$$$$$$ |  \\$$$$  |$$ |
\\__|\\________| \\_______|         \\_______|   \\____/ \\__|
`;

// 新增：获取目录下的文件列表
async function getFilesList(extensions) {
    const files = await fs.readdir(process.cwd());
    return files.filter(file => {
        if (!extensions) return true;
        const ext = path.extname(file).toLowerCase();
        return extensions.includes(ext);
    });
}

// 新增：读取缓存的选择
async function loadCache() {
    try {
        const cachePath = path.join(process.cwd(), '.lzc-dtl-cache.json');
        if (await fs.pathExists(cachePath)) {
            return await fs.readJson(cachePath);
        }
    } catch (error) {
        console.warn('读取缓存失败:', error.message);
    }
    return {};
}

// 修改：保存选择到缓存
async function saveCache(cache) {
    try {
        const cachePath = path.join(process.cwd(), '.lzc-dtl-cache.json');
        // 如果缓存文件已存在，先读取现有内容
        let existingCache = {};
        if (await fs.pathExists(cachePath)) {
            existingCache = await fs.readJson(cachePath);
        }
        // 合并现有缓存和新缓存
        const mergedCache = {
            ...existingCache,
            ...cache
        };
        // 特殊处理镜像缓存
        for (const [key, value] of Object.entries(cache)) {
            if (key.startsWith('image_')) {
                mergedCache[key] = {
                    ...(existingCache[key] || {}),
                    ...value
                };
            }
        }
        await fs.writeJson(cachePath, mergedCache, { spaces: 2 });
    } catch (error) {
        console.warn('保存缓存失败:', error.message);
    }
}

// 修改 updateCache 函数
async function updateCache(cache, updates) {
    // 创建深拷贝以避免直接修改原对象
    const newCache = JSON.parse(JSON.stringify(cache));
    
    // 递归合并对象，确保布尔值和镜像缓存正确处理
    for (const [key, value] of Object.entries(updates)) {
        if (key.startsWith('image_')) {
            // 特殊处理镜像缓存
            newCache[key] = {
                ...(newCache[key] || {}),  // 保留现有的镜像缓存
                ...value                    // 合并新的值
            };
        } else if (key === 'registryUrl') {
            // 保存全局注册表地址
            newCache.registryUrl = value;
        } else if (value && typeof value === 'object' && !Array.isArray(value)) {
            // 处理嵌套对象
            newCache[key] = newCache[key] || {};
            for (const [nestedKey, nestedValue] of Object.entries(value)) {
                if (typeof nestedValue === 'object' && !Array.isArray(nestedValue)) {
                    newCache[key][nestedKey] = {
                        ...(newCache[key][nestedKey] || {}),
                        ...nestedValue
                    };
                } else {
                    newCache[key][nestedKey] = nestedValue;
                }
            }
        } else if (typeof value === 'boolean') {
            // 确保布尔值被正确保存
            newCache[key] = value;
        } else {
            newCache[key] = value;
        }
    }
    
    // 使用修改后的 saveCache 函数
    await saveCache(newCache);
    return newCache;
}

async function convertApp(options = {}) {
    console.log(ASCII_LOGO);
    console.log('欢迎使用懒猫微服应用转换器');
    console.log('这个转换器可以把 docker-compose.yml 方便地转换为 懒猫微服 lpk 应用包。\n');

    let answers;
    let cache = await loadCache();
    
    // 在收集功能选项之前，先收集基本信息
    if (!options.nonInteractive) {
        const questions = [];
        
        // 基本信息设置
        if (!options.name) {
            questions.push({
                type: 'input',
                name: 'name',
                message: '请输入应用名称：',
                default: cache.name || undefined,
                validate: input => input.trim() ? true : '应用名称不能为空'
            });
        }

        if (!options.package) {
            questions.push({
                type: 'input',
                name: 'package',
                message: '请输入应用包名：',
                default: cache.package || undefined
            });
        }

        if (!options.version) {
            questions.push({
                type: 'input',
                name: 'version',
                message: '请输入应用版本：',
                default: cache.version || '0.0.1',
                validate: input => {
                    const semverRegex = /^\d+\.\d+\.\d+$/;
                    if (!semverRegex.test(input)) {
                        return '请输入有效的版本号（例如：1.0.0）';
                    }
                    return true;
                }
            });
        }

        // 添加不支持平台的选择
        questions.push({
            type: 'checkbox',
            name: 'unsupported_platforms',
            message: '请选择不支持的平台（默认全平台支持）：',
            choices: [
                { name: 'iOS 和 iPad 移动端', value: 'ios' },
                { name: 'Android 移动端', value: 'android' },
                { name: 'Linux 桌面端', value: 'linux' },
                { name: 'Windows 桌面端', value: 'windows' },
                { name: 'macOS 桌面端', value: 'macos' },
                { name: '懒猫智慧屏平台端', value: 'tvos' }
            ],
            default: cache.unsupported_platforms || []
        });

        // 在不支持平台选项后面添加系统版本依赖配置
        questions.push({
            type: 'confirm',
            name: 'has_version_requirement',
            message: '是否需要限制系统版本？',
            default: cache.has_version_requirement || false
        });

        // 如果用户选择需要限制系统版本，则询问具体版本要求
        questions.push({
            type: 'input',
            name: 'min_os_version',
            message: '请输入最低系统版本要求（如: >= 1.0.18）：',
            default: cache.min_os_version || '>= 1.0.18',
            when: (answers) => answers.has_version_requirement,
            validate: (input) => {
                // 验证版本号格式
                const versionPattern = /^(>=|>|<=|<|=)\s*\d+\.\d+\.\d+$/;
                if (!versionPattern.test(input.trim())) {
                    return '请输入正确的版本号格式，如: >= 1.0.18';
                }
                return true;
            }
        });

        if (!options.description) {
            questions.push({
                type: 'input',
                name: 'description',
                message: '请输入应用描述：',
                default: cache.description || undefined
            });
        }

        if (!options.homepage) {
            questions.push({
                type: 'input',
                name: 'homepage',
                message: '请输入应用首页：',
                default: cache.homepage || undefined
            });
        }

        if (!options.author) {
            questions.push({
                type: 'input',
                name: 'author',
                message: '请输入作者：',
                default: cache.author || undefined
            });
        }

        // 添加功能选择
        questions.push({
            type: 'checkbox',
            name: 'app_features',
            message: '请选择应用功能：',
            choices: [
                { name: '开机自启，后台运行', value: 'background_task', checked: cache.app_features?.includes('background_task') },
                { name: '每个用户创建一个实例', value: 'multi_instance', checked: cache.app_features?.includes('multi_instance') },
                { name: '公开路由 (无需登录即可访问)', value: 'public_path', checked: cache.app_features?.includes('public_path') },
                { name: 'GPU加速', value: 'gpu_accel', checked: cache.app_features?.includes('gpu_accel') },
                { name: 'KVM加速', value: 'kvm_accel', checked: cache.app_features?.includes('kvm_accel') },
                { name: 'USB设备挂载', value: 'usb_accel', checked: cache.app_features?.includes('usb_accel') },
                { name: '文件关联 (可以打开特定类型文件)', value: 'file_handler', checked: cache.app_features?.includes('file_handler') }
            ]
        });

        if (!options.subdomain) {
            questions.push({
                type: 'input',
                name: 'subdomain',
                message: '请输入子域名：',
                default: cache.subdomain || undefined
            });
        }

        const promptAnswers = await inquirer.prompt(questions);
        answers = { ...options, ...promptAnswers };

        // 更新基本信息和功能选择到缓存
        cache = await updateCache(cache, {
            name: answers.name,
            package: answers.package,
            description: answers.description,
            homepage: answers.homepage,
            author: answers.author,
            app_features: answers.app_features,
            subdomain: answers.subdomain,
            version: answers.version
        });

        // 根据选择的功能收集详细配置
        if (answers.app_features?.length > 0) {
            // 如果选择了公开路由，收集路由配置
            if (answers.app_features.includes('public_path')) {
                let publicPaths = [];
                let addMorePaths = true;

                while (addMorePaths) {
                    const publicPathAnswer = await inquirer.prompt([
                        {
                            type: 'input',
                            name: 'path',
                            message: '请输入需要公开访问的路径：',
                            default: '/',
                            validate: input => input.trim() ? true : '路径不能为空'
                        },
                        {
                            type: 'confirm',
                            name: 'addMore',
                            message: '是否继续添加公开路径？',
                            default: false
                        }
                    ]);

                    publicPaths.push(publicPathAnswer.path);
                    addMorePaths = publicPathAnswer.addMore;
                }

                answers.public_paths = publicPaths;
                cache = await updateCache(cache, { public_paths: publicPaths });
            }

            // 修改文件关联配置的收集部分
            if (answers.app_features.includes('file_handler')) {
                let mimeTypes = [];
                let addMoreTypes = true;

                // 从缓存中获取上次的 MIME 类型
                const cachedMimeTypes = cache.mime_types || [];
                
                // 如果有缓存的 MIME 类型，询问是否使用
                if (cachedMimeTypes.length > 0) {
                    const useCacheAnswer = await inquirer.prompt([{
                        type: 'confirm',
                        name: 'useCache',
                        message: `发现已缓存的MIME类型配置 [${cachedMimeTypes.join(', ')}]，是否使用？`,
                        default: true
                    }]);

                    if (useCacheAnswer.useCache) {
                        mimeTypes = [...cachedMimeTypes];
                        addMoreTypes = false;
                    }
                }

                while (addMoreTypes) {
                    const fileHandlerAnswers = await inquirer.prompt([
                        {
                            type: 'input',
                            name: 'mime_types',
                            message: '请输入支持的MIME类型（多个类型用空格分隔，如 audio/mpeg audio/mp3）：',
                            default: cachedMimeTypes.join(' ') || undefined,
                            validate: input => {
                                if (!input.trim()) return '请输入至少一个MIME类型';
                                // 简单验证MIME格式
                                const types = input.trim().split(/\s+/);
                                const invalidTypes = types.filter(type => !type.includes('/'));
                                if (invalidTypes.length > 0) {
                                    return `无效的MIME类型: ${invalidTypes.join(', ')}`;
                                }
                                return true;
                            }
                        },
                        {
                            type: 'confirm',
                            name: 'addMore',
                            message: '是否继续添加MIME类型？',
                            default: false
                        }
                    ]);

                    // 分割输入的MIME类型并添加到数组
                    const newTypes = fileHandlerAnswers.mime_types.trim().split(/\s+/);
                    mimeTypes.push(...newTypes);
                    addMoreTypes = fileHandlerAnswers.addMore;
                }

                // 去重
                mimeTypes = [...new Set(mimeTypes)];

                // 收集打开文件的路由路径
                const openActionAnswer = await inquirer.prompt([{
                    type: 'input',
                    name: 'open_action',
                    message: '请输入打开文件的路由路径（使用 %u 作为文件路径占位符）：',
                    default: cache.open_action || '/open?file=%u',
                    validate: input => input.includes('%u') ? true : '路径必须包含 %u 作为文件路径占位符'
                }]);

                answers.file_handler = {
                    mime: mimeTypes,
                    actions: { open: openActionAnswer.open_action }
                };

                cache = await updateCache(cache, {
                    mime_types: mimeTypes,
                    open_action: openActionAnswer.open_action
                });
            }
        }

        // 在收集完基本配置后，继续处理图标文件等其他配置
        if (!options.nonInteractive) {
            // 处理图标文件
            if (!options.icon) {
                const imageFiles = await getFilesList(['.png', '.jpg', '.jpeg', '.gif']);
                if (imageFiles.length === 0) {
                    throw new Error('当前目录下没有找到图片文件');
                }

                const iconAnswer = await inquirer.prompt([{
                    type: 'list',
                    name: 'iconPath',
                    message: '请选择图标文件：',
                    choices: imageFiles,
                    pageSize: 10,
                    default: cache.iconPath || undefined
                }]);
                options.icon = iconAnswer.iconPath;
                
                // 使用辅助函数更新缓存
                cache = await updateCache(cache, { iconPath: options.icon });
            }

            // 处理 docker-compose.yml
            if (!options.compose) {
                const yamlFiles = await getFilesList(['.yml', '.yaml']);
                if (yamlFiles.length === 0) {
                    throw new Error('当前目录下没有找到 YAML 文件');
                }

                const composeAnswer = await inquirer.prompt([{
                    type: 'list',
                    name: 'composePath',
                    message: '请选择 docker-compose 文件：',
                    choices: yamlFiles,
                    pageSize: 10,
                    default: cache.composePath || undefined
                }]);
                options.compose = composeAnswer.composePath;
                
                // 使用辅助函��更新缓存
                cache = await updateCache(cache, { composePath: options.compose });
            }
        }
    } else {
        // 使用命令行参数时，确保这两个值有效
        if (options.backgroundTask === undefined || options.backgroundTask === null) {
            throw new Error('在交互模下必须指定 --background-task 选项');
        }
        if (options.multiInstance === undefined || options.multiInstance === null) {
            throw new Error('在非交互式下必须指定 --multi-instance 选项');
        }
        
        answers = {
            name: options.name,
            package: options.package,
            description: options.description,
            homepage: options.homepage,
            author: options.author,
            background_task: options.backgroundTask,
            multi_instance: options.multiInstance,
            publicPaths: options.publicPaths,
            subdomain: options.subdomain
        };
    }

    // 验证选择的
    try {
        const composeContent = await fs.readFile(options.compose, 'utf8');
        const composeData = YAML.parse(composeContent);
        
        // 验证是否是有效的 docker-compose 文件
        if (!composeData.services) {
            throw new Error('选择的文件不是有效的 docker-compose 文件');
        }

        // 获取服务列表用于由选择
        const services = Object.keys(composeData.services);

        // 生成 manifest.yml
        const manifest = {
            'lzc-sdk-version': '0.1',
            name: answers.name,
            package: answers.package,
            version: answers.version || '0.0.1',
            description: answers.description,
            homepage: answers.homepage,
            author: answers.author,
            application: {
                subdomain: answers.subdomain,
                background_task: answers.app_features?.includes('background_task') || false,
                multi_instance: answers.app_features?.includes('multi_instance') || false,
                gpu_accel: answers.app_features?.includes('gpu_accel') || false,
                kvm_accel: answers.app_features?.includes('kvm_accel') || false,
                usb_accel: answers.app_features?.includes('usb_accel') || false
            },
            services: {}
        };

        // 添加文件关联配置
        if (answers.file_handler) {
            manifest.application.file_handler = {
                mime: answers.file_handler.mime,
                actions: answers.file_handler.actions
            };
        }

        // 如果选择了不支持的平台，添加到 manifest 中
        if (answers.unsupported_platforms && answers.unsupported_platforms.length > 0) {
            manifest.unsupported_platforms = answers.unsupported_platforms;
        }

        // 更新缓存
        cache = await updateCache(cache, {
            unsupported_platforms: answers.unsupported_platforms
        });

        // 添加公开路由配置
        if (answers.public_paths) {
            manifest.application.public_path = answers.public_paths;
        }

        // 添加GPU配置
        if (answers.gpu_accel) {
            manifest.application.gpu_accel = true;
        }

        // 添加文件关联配置
        if (answers.file_handler) {
            manifest.application.file_handler = answers.file_handler;
        }

        // 处理路由规则
        let routes = [];
        if (!options.routes) {
            const routeTypes = [
                { name: 'HTTP路由', value: 'http' },
                { name: 'HTTPS路由', value: 'https' },
                { name: 'TCP/UDP端口暴露', value: 'port' },
                { name: '从docker-compose读取端口', value: 'from_compose' },
                { name: '静态文件路由', value: 'static' }
            ];

            // 询问是否需要添更多路由
            let addMore = true;
            while (addMore) {
                // 路由类型
                const routeTypeAnswer = await inquirer.prompt([{
                    type: 'list',
                    name: 'type',
                    message: '请选择路由类型：',
                    choices: routeTypes,
                    default: cache.lastRouteType || undefined
                }]);

                // 使用辅助函数更新缓存
                cache = await updateCache(cache, { lastRouteType: routeTypeAnswer.type });

                if (routeTypeAnswer.type === 'from_compose') {
                    // 从 docker-compose 读端口
                    for (const [serviceName, service] of Object.entries(composeData.services)) {
                        if (service.ports) {
                            for (const portMapping of service.ports) {
                                // 处理不同格式的端口映射
                                let hostPort, containerPort;
                                
                                if (typeof portMapping === 'string') {
                                    if (portMapping.includes(':')) {
                                        // 处理 1080:80 格式
                                        [hostPort, containerPort] = portMapping.split(':');
                                    } else {
                                        // 处理 80 格式
                                        containerPort = portMapping;
                                        hostPort = portMapping;
                                    }
                                } else if (typeof portMapping === 'number') {
                                    // 处理纯数字格式
                                    containerPort = portMapping.toString();
                                    hostPort = containerPort;
                                }
                                
                                // 移除可能的协议前缀（ "80/tcp"）
                                containerPort = containerPort.split('/')[0];
                                hostPort = hostPort.split('/')[0];
                                
                                // 生成个更有结构的缓存键
                                const cacheKey = `port_mappings`;
                                const mappingKey = `${serviceName}_${hostPort}_${containerPort}`;
                                
                                // 确保布尔值默认值正确处理
                                const usePortAnswer = await inquirer.prompt([{
                                    type: 'confirm',
                                    name: 'use',
                                    message: `是否添加服务 ${serviceName} 的端口映射 ${hostPort}:${containerPort}？`,
                                    default: cache[cacheKey]?.[mappingKey]?.use === undefined ? true : cache[cacheKey]?.[mappingKey]?.use
                                }]);

                                if (usePortAnswer.use) {
                                    // 询问路由类型
                                    const routeTypeForPort = await inquirer.prompt([{
                                        type: 'list',
                                        name: 'type',
                                        message: `请选择 ${serviceName}:${containerPort} 的路由类型：`,
                                        choices: [
                                            { name: 'HTTP路由', value: 'http' },
                                            { name: 'HTTPS路由', value: 'https' },
                                            { name: 'TCP/UDP端口暴露', value: 'port' }
                                        ],
                                        default: cache[cacheKey]?.[mappingKey]?.type || 'http'
                                    }]);

                                    if (routeTypeForPort.type === 'port') {
                                        // 询问协议类型
                                        const protocolAnswer = await inquirer.prompt([{
                                            type: 'list',
                                            name: 'protocol',
                                            message: '请选择协议：',
                                            choices: ['tcp', 'udp'],
                                            default: cache[cacheKey]?.[mappingKey]?.protocol || 'tcp'
                                        }]);

                                        // 使用更新后的缓存结构
                                        cache = await updateCache(cache, {
                                            [cacheKey]: {
                                                [mappingKey]: {
                                                    use: usePortAnswer.use === true,
                                                    type: routeTypeForPort.type,
                                                    protocol: protocolAnswer.protocol
                                                }
                                            }
                                        });

                                        routes.push({
                                            type: 'ingress',
                                            config: {
                                                protocol: protocolAnswer.protocol,
                                                port: parseInt(containerPort),
                                                service: serviceName
                                            }
                                        });
                                    } else {
                                        // HTTP/HTTPS路由
                                        const pathAnswer = await inquirer.prompt([{
                                            type: 'input',
                                            name: 'path',
                                            message: '请输入路由路径（如 /api/）：',
                                            default: cache[cacheKey]?.[mappingKey]?.path || '/'
                                        }]);

                                        // 询问目标路径
                                        const targetPathAnswer = await inquirer.prompt([{
                                            type: 'input',
                                            name: 'targetPath',
                                            message: '请输入目标路径（如 / 或 /api/）：',
                                            default: cache[cacheKey]?.[mappingKey]?.targetPath || '/'
                                        }]);

                                        // 使用更新后的缓存结构
                                        cache = await updateCache(cache, {
                                            [cacheKey]: {
                                                [mappingKey]: {
                                                    use: usePortAnswer.use === true,
                                                    type: routeTypeForPort.type,
                                                    path: pathAnswer.path,
                                                    targetPath: targetPathAnswer.targetPath
                                                }
                                            }
                                        });

                                        // 构建 URL，确保路径��确拼接
                                        const targetPath = targetPathAnswer.targetPath.startsWith('/') ? targetPathAnswer.targetPath : '/' + targetPathAnswer.targetPath;
                                        const target = `${routeTypeForPort.type}://${serviceName}.${answers.package}.lzcapp:${containerPort}${targetPath}`;

                                        routes.push({
                                            type: 'http',
                                            config: {
                                                path: pathAnswer.path,
                                                target: target
                                            }
                                        });
                                    }
                                } else {
                                    // 保存不使用的选择
                                    cache = await updateCache(cache, {
                                        [cacheKey]: {
                                            [mappingKey]: {
                                                use: false
                                            }
                                        }
                                    });
                                }
                            }
                        }
                    }
                } else if (routeTypeAnswer.type === 'port') {
                    const portConfig = await inquirer.prompt([
                        {
                            type: 'list',
                            name: 'protocol',
                            message: '请选择协议：',
                            choices: ['tcp', 'udp'],
                            default: cache.lastPortProtocol || undefined
                        },
                        {
                            type: 'input',
                            name: 'port',
                            message: '请输入端口号：',
                            default: cache.lastPort || undefined,
                            validate: (input) => {
                                const port = parseInt(input);
                                if (isNaN(port) || port < 1 || port > 65535) {
                                    return '请输入有效的端号（1-65535）';
                                }
                                return true;
                            }
                        },
                        {
                            type: 'list',
                            name: 'service',
                            message: '请选择服务：',
                            choices: services,
                            default: cache.lastService || undefined
                        }
                    ]);

                    // 使用辅助函数更新缓存
                    cache = await updateCache(cache, {
                        lastPortProtocol: portConfig.protocol,
                        lastPort: portConfig.port,
                        lastService: portConfig.service
                    });

                    // 添加 TCP/UDP 端口路由
                    routes.push({
                        type: 'ingress',
                        config: {
                            protocol: portConfig.protocol,
                            port: parseInt(portConfig.port),
                            service: portConfig.service
                        }
                    });

                } else if (routeTypeAnswer.type === 'http' || routeTypeAnswer.type === 'https') {
                    const httpConfig = await inquirer.prompt([
                        {
                            type: 'input',
                            name: 'path',
                            message: '请输入路由路径（如 /api/）：',
                            default: cache.lastHttpPath || '/'
                        },
                        {
                            type: 'list',
                            name: 'service',
                            message: '请选择服务：',
                            choices: services,
                            default: cache.lastHttpService || undefined
                        },
                        {
                            type: 'input',
                            name: 'port',
                            message: '请输入服务端口：',
                            default: cache.lastHttpPort || undefined,
                            validate: (input) => {
                                const port = parseInt(input);
                                if (isNaN(port) || port < 1 || port > 65535) {
                                    return '请输入有效的端口号（1-65535）';
                                }
                                return true;
                            }
                        },
                        {
                            type: 'input',
                            name: 'targetPath',
                            message: '请输入目标路径（如 / 或 /api/）：',
                            default: cache.lastHttpTargetPath || '/'
                        }
                    ]);

                    // 使用辅助函数更新缓存
                    cache = await updateCache(cache, {
                        lastHttpPath: httpConfig.path,
                        lastHttpService: httpConfig.service,
                        lastHttpPort: httpConfig.port,
                        lastHttpTargetPath: httpConfig.targetPath
                    });

                    // 构建目标 URL，确保路径正确拼接
                    const targetPath = httpConfig.targetPath.startsWith('/') ? httpConfig.targetPath : '/' + httpConfig.targetPath;
                    const target = `${routeTypeAnswer.type}://${httpConfig.service}.${answers.package}.lzcapp:${httpConfig.port}${targetPath}`;

                    // 添加 HTTP/HTTPS 路由
                    routes.push({
                        type: 'http',
                        config: {
                            path: httpConfig.path,
                            target: target
                        }
                    });
                } else if (routeTypeAnswer.type === 'static') {
                    const staticConfig = await inquirer.prompt([
                        {
                            type: 'input',
                            name: 'path',
                            message: '请输入路由路径（如 /）：',
                            default: cache.lastStaticPath || '/'
                        },
                        {
                            type: 'input',
                            name: 'contentPath',
                            message: '请输入静态文件目录路径（相对于应用包内容目录）：',
                            default: cache.lastContentPath || 'web'
                        }
                    ]);

                    // 更新缓存
                    cache = await updateCache(cache, {
                        lastStaticPath: staticConfig.path,
                        lastContentPath: staticConfig.contentPath
                    });

                    // 添加静态文件路由
                    routes.push({
                        type: 'http',
                        config: {
                            path: staticConfig.path,
                            target: `file:///lzcapp/pkg/content/${staticConfig.contentPath}`
                        }
                    });
                }

                // 询问是否继续添加路由
                const continueAnswer = await inquirer.prompt([{
                    type: 'confirm',
                    name: 'addMore',
                    message: '是否继续添加路由？',
                    default: false
                }]);

                addMore = continueAnswer.addMore;
            }
        } else {
            // 处理命令行参数中的路由配置
            routes = options.routes;
        }

        // 添加路由配置
        const httpRoutes = routes
            .filter(r => r.type === 'http')
            .map(r => `${r.config.path}=${r.config.target}`);
        
        if (httpRoutes.length > 0) {
            manifest.application.routes = httpRoutes;
        }

        // 添加端口露配置
        const ingressRoutes = routes.filter(r => r.type === 'ingress');
        if (ingressRoutes.length > 0) {
            manifest.application.ingress = ingressRoutes.map(r => ({
                protocol: r.config.protocol,
                port: r.config.port,
                service: r.config.service
            }));
        }

        // 在处理 services 的部之前，直接在当前目录创建 content.tar
        const executionDir = process.cwd(); // 获取 lzc-dtl 执行的目录

        // 创建 content.tar，包含当前目录下的有文件和目录
        await tar.create(
            {
                file: 'content.tar',
                cwd: executionDir,
                portable: true,
                // 排除一些不需要的文件和目录
                filter: (path) => {
                    const excludes = ['node_modules', '.git', '*.lpk', 'content.tar'];
                    return !excludes.some(exclude => path.includes(exclude));
                }
            },
            await fs.readdir(executionDir)
        );

        // Load environment variables from .env file
        const envPath = path.join(process.cwd(), '.env');
        const envConfig = dotenv.config({ path: envPath }).parsed || {};

        // 添加一个处理环境变量替换的辅助数
        function processEnvVariables(value, envConfig) {
            if (typeof value !== 'string') return value;
            
            let processedValue = value;
            const envMatches = value.match(/\${[^}]+}/g);
            
            if (envMatches) {
                for (const match of envMatches) {
                    const envExpression = match.slice(2, -1);
                    let envName, defaultValue;
                    
                    if (envExpression.includes(':-')) {
                        [envName, defaultValue] = envExpression.split(':-');
                        // 尝试将默认值转换为数字
                        if (!isNaN(defaultValue) && defaultValue.trim() !== '') {
                            defaultValue = Number(defaultValue);
                        }
                    } else {
                        envName = envExpression;
                    }
                    
                    // 获取环境变量值或使用默认值
                    const envValue = envConfig[envName] || process.env[envName] || defaultValue || '';
                    
                    // 如果替换值是数字，直接使用数字值而不是字符串
                    if (typeof envValue === 'number') {
                        processedValue = processedValue.replace(match, envValue);
                    } else {
                        processedValue = processedValue.replace(match, envValue.toString());
                    }
                }
            }
            
            // 如果整个值是数字字符串，转换为数字
            if (!isNaN(processedValue) && processedValue.trim() !== '') {
                return Number(processedValue);
            }
            
            return processedValue;
        }

        // Load global config
        const globalConfig = await loadGlobalConfig();

        // 添加处理构建的函数
        async function processBuild(serviceName, packageName, cache, globalConfig, service) {
            // Generate cache key for this build
            const buildKey = `build_${serviceName}`;
            
            // 如果构建缓存存在且有 imageName，询问是否使用缓存
            if (cache[buildKey]?.imageName) {
                const useCacheAnswer = await inquirer.prompt([{
                    type: 'confirm',
                    name: 'useCache',
                    message: `[${serviceName}] 发现已缓存的构建配置，是否使用？`,
                    default: true
                }]);

                if (useCacheAnswer.useCache) {
                    console.log(`[${serviceName}] 使用缓存的构建配置: ${cache[buildKey].imageName}`);
                    return cache[buildKey].imageName;
                }
            }
            
            // Ask if user wants to build
            const buildAnswer = await inquirer.prompt([{
                type: 'confirm',
                name: 'build',
                message: `[${serviceName}] 是否需要构建镜像？`,
                default: cache[buildKey]?.build === undefined ? true : cache[buildKey]?.build
            }]);
            
            // 更新缓存
            let buildCache = {
                ...(cache[buildKey] || {}),
                build: buildAnswer.build
            };
            
            cache = await updateCache(cache, {
                [buildKey]: buildCache
            });
            
            if (!buildAnswer.build) {
                throw new Error(`服务 ${serviceName} 既没有 image 也不构建，无法继续`);
            }
            
            // 获取构建配置
            const buildConfig = service.build;
            let buildContext = '.';
            let dockerfilePath = null;

            // 处理构建配置
            if (typeof buildConfig === 'string') {
                buildContext = buildConfig;
            } else if (typeof buildConfig === 'object') {
                buildContext = buildConfig.context || '.';
                dockerfilePath = buildConfig.dockerfile;
            }

            // 解析构建上下文路径（相对于 docker-compose 文件位置）
            const composeDir = path.dirname(path.resolve(process.cwd(), options.compose));
            buildContext = path.resolve(composeDir, buildContext);

            // 询问推送目标
            const pushTargetAnswer = await inquirer.prompt([{
                type: 'list',
                name: 'target',
                message: `[${serviceName}] 请选择构建镜像的推送目标：`,
                choices: [
                    { name: '推送到自定义镜像仓库', value: 'custom' },
                    { name: '推送到懒猫微服官方镜像源', value: 'lazycat' }
                ],
                default: cache[buildKey]?.pushTarget || 'custom'
            }]);

            // 更新缓存
            buildCache = {
                ...buildCache,
                pushTarget: pushTargetAnswer.target
            };

            let registryUrl;
            let imageName;

            if (pushTargetAnswer.target === 'custom') {
                // 获取自定义仓库地址
                registryUrl = cache.registryUrl;
                if (!registryUrl && globalConfig.registryUrl) {
                    registryUrl = globalConfig.registryUrl;
                }

                if (!registryUrl) {
                    const registryAnswer = await inquirer.prompt([{
                        type: 'input',
                        name: 'url',
                        message: '请输入远程仓库地址：',
                        validate: input => input.trim() ? true : '仓库地址不能为空'
                    }]);

                    registryUrl = registryAnswer.url;

                    const saveGloballyAnswer = await inquirer.prompt([{
                        type: 'confirm',
                        name: 'save',
                        message: '是否要全局保存该仓库地址？',
                        default: true
                    }]);

                    if (saveGloballyAnswer.save) {
                        await saveGlobalConfig({ ...globalConfig, registryUrl });
                    }

                    cache = await updateCache(cache, { registryUrl });
                }

                // 生成镜像名称
                const packageBaseName = packageName.split('.').pop();
                const buildHash = crypto.createHash('md5').update(`${serviceName}_${new Date().toISOString()}`).digest('hex');
                imageName = `${registryUrl}/${packageBaseName}:${buildHash}`;
            } else {
                // 为懒猫微服生成临时镜像名称
                const tempHash = crypto.createHash('md5').update(`${serviceName}_${new Date().toISOString()}`).digest('hex');
                imageName = `temp-build-${tempHash}`;
            }

            // 构建命令
            let buildCmd = `docker build -t ${imageName}`;
            if (dockerfilePath) {
                // 解析 Dockerfile 路径（相对于构建上下文）
                const fullDockerfilePath = path.resolve(buildContext, dockerfilePath);
                buildCmd += ` -f "${fullDockerfilePath}"`;
            }
            buildCmd += ` "${buildContext}"`;

            console.log(`[${serviceName}] 正在构建镜像: ${imageName}`);
            console.log(`[${serviceName}] 构建上下文: ${buildContext}`);
            if (dockerfilePath) {
                console.log(`[${serviceName}] Dockerfile: ${dockerfilePath}`);
            }

            await execCommand(buildCmd);

            if (pushTargetAnswer.target === 'lazycat') {
                console.log(`[${serviceName}] 正在推送镜像到懒猫微服官方镜像源...`);
                const { stdout } = await execCommand(`lzc-cli appstore copy-image ${imageName}`);
                
                // 从输出中提取新的镜像地址
                const match = stdout.match(/lazycat-registry: (.*)/);
                if (!match) {
                    throw new Error('无法从输出中获取懒猫微服镜像地址');
                }
                imageName = match[1].trim();
            } else {
                console.log(`[${serviceName}] 正在推送镜像到远程仓库: ${imageName}`);
                await execCommand(`docker push ${imageName}`);
            }

            // 更新缓存
            buildCache = {
                ...buildCache,
                imageName,
                timestamp: new Date().toISOString()
            };

            cache = await updateCache(cache, {
                [buildKey]: buildCache
            });

            return imageName;
        }

        // 修改服务处理部分
        for (const [name, service] of Object.entries(composeData.services)) {
            // 处理服务名称中的环境变量
            const processedName = processEnvVariables(name, envConfig);
            
            let serviceImage;
            
            // 如果同时存在 build 和 image 配置，让用户选择
            if (service.build && service.image) {
                const choiceAnswer = await inquirer.prompt([{
                    type: 'list',
                    name: 'choice',
                    message: `[${processedName}] 同时存在构建配置和镜像配置，请选择：`,
                    choices: [
                        { name: '使用构建配置 (build)', value: 'build' },
                        { name: '使用镜像配置 (image)', value: 'image' }
                    ],
                    default: cache[`${processedName}_build_or_image`] || 'build'
                }]);

                // 更新缓存
                cache = await updateCache(cache, {
                    [`${processedName}_build_or_image`]: choiceAnswer.choice
                });

                if (choiceAnswer.choice === 'build') {
                    serviceImage = await processBuild(processedName, answers.package, cache, globalConfig, service);
                } else {
                    const processedImage = processEnvVariables(service.image, envConfig);
                    serviceImage = await processImage(processedImage, answers.package, cache, globalConfig, processedName);
                }
            }
            // 只有 build 配置
            else if (service.build) {
                serviceImage = await processBuild(processedName, answers.package, cache, globalConfig, service);
            }
            // 只有 image 配置
            else if (service.image) {
                const processedImage = processEnvVariables(service.image, envConfig);
                serviceImage = await processImage(processedImage, answers.package, cache, globalConfig, processedName);
            }
            // 既没有 build 也没有 image
            else {
                throw new Error(`服务 ${processedName} 既没有 image 也没有 build 配置`);
            }

            manifest.services[processedName] = {
                image: serviceImage
            };

            // 处理环境变量
            if (service.env_file) {
                let envFiles = [];
                if (Array.isArray(service.env_file)) {
                    envFiles = service.env_file;
                } else {
                    envFiles = [service.env_file];
                }

                // 合并所有环境变量文件的内容
                let mergedEnvConfig = {};
                for (const envFile of envFiles) {
                    const envFilePath = path.resolve(executionDir, processEnvVariables(envFile, envConfig));
                    try {
                        if (await fs.pathExists(envFilePath)) {
                            const fileEnvConfig = dotenv.config({ path: envFilePath }).parsed || {};
                            // 后面的文件会覆盖前面文件中的同名变量
                            mergedEnvConfig = {
                                ...mergedEnvConfig,
                                ...fileEnvConfig
                            };
                        } else {
                            console.warn(`警告: 环境变量文件 ${envFilePath} 不存在`);
                        }
                    } catch (error) {
                        console.warn(`警告: 读取环境变量文件 ${envFilePath} 失败:`, error.message);
                    }
                }

                manifest.services[processedName].environment = Object.entries(mergedEnvConfig).map(
                    ([key, value]) => `${processEnvVariables(key, envConfig)}=${processEnvVariables(value, envConfig)}`
                );
            } else if (service.environment) {
                if (Array.isArray(service.environment)) {
                    manifest.services[processedName].environment = service.environment.map(env => {
                        if (typeof env === 'string') {
                            const [key, value] = env.split('=');
                            return `${processEnvVariables(key, envConfig)}=${processEnvVariables(value, envConfig)}`;
                        }
                        return env;
                    });
                } else {
                    manifest.services[processedName].environment = [];
                    for (const [key, value] of Object.entries(service.environment)) {
                        const processedKey = processEnvVariables(key, envConfig);
                        const processedValue = processEnvVariables(value, envConfig);
                        manifest.services[processedName].environment.push(`${processedKey}=${processedValue}`);
                    }
                }
            }

            // 处理命令中的环境变量
            if (service.command) {
                let processedCommand;
                if (Array.isArray(service.command)) {
                    // 如果是数组，先处理每个元素的环境变量，然后用空格连接
                    processedCommand = service.command
                        .map(cmd => processEnvVariables(cmd, envConfig))
                        .join(' ');
                } else {
                    // 如果是字符串，直接处理环境变量
                    processedCommand = processEnvVariables(service.command, envConfig);
                }
                manifest.services[processedName].command = processedCommand;
            }

            // 处理 entrypoint 中的环境变量
            if (service.entrypoint) {
                let processedEntrypoint;
                if (Array.isArray(service.entrypoint)) {
                    // 如果是数组，先处理每个元素的环境变量，然后空格连接
                    processedEntrypoint = service.entrypoint
                        .map(entry => processEnvVariables(entry, envConfig))
                        .join(' ');
                } else {
                    // 如果是字符串，直接处理环境变量
                    processedEntrypoint = processEnvVariables(service.entrypoint, envConfig);
                }
                manifest.services[processedName].entrypoint = processedEntrypoint;
            }

            // 修改处理依赖关系部分
            if (service.depends_on) {
                if (Array.isArray(service.depends_on)) {
                    manifest.services[processedName].depends_on = service.depends_on.map(dep => 
                        processEnvVariables(dep, envConfig)
                    );
                } else {
                    // 对于对象格式的 depends_on，只取服务名称
                    manifest.services[processedName].depends_on = Object.keys(service.depends_on).map(dep =>
                        processEnvVariables(dep, envConfig)
                    );
                }
            }

            // 处理卷挂载中的环境变量
            if (service.volumes) {
                manifest.services[processedName].binds = [];
                
                for (const volume of service.volumes) {
                    // 移除注释部分并处理环境变量
                    const volumeConfig = typeof volume === 'string' ? 
                        processEnvVariables(volume.split('#')[0].trim(), envConfig) : 
                        volume;
                    
                    if (!volumeConfig) continue;

                    let targetPath;
                    let sourcePath;

                    // 提取目标路径，不管是对象格式还是字符串格式
                    if (typeof volumeConfig === 'object') {
                        targetPath = processEnvVariables(volumeConfig.target, envConfig);
                        if (volumeConfig.source) {
                            sourcePath = processEnvVariables(volumeConfig.source, envConfig);
                        }
                    } else {
                        // 分割源路径和目标路径
                        const volumeParts = volumeConfig.split(':');
                        if (volumeParts.length === 1) {
                            // 处理匿名卷
                            targetPath = volumeParts[0].trim();
                            
                            // 询问���户如何处理匿名卷
                            const volumeActionAnswer = await inquirer.prompt([{
                                type: 'list',
                                name: 'action',
                                message: `如何处理匿名卷 ${targetPath}？`,
                                choices: [
                                    { name: '挂载空目录', value: 'emptyDir' },
                                    { name: '忽略挂载', value: 'ignore' }
                                ],
                                default: cache[`${processedName}_volume_${targetPath}_action`] || 'emptyDir'
                            }]);

                            // 更新缓存
                            cache = await updateCache(cache, {
                                [`${processedName}_volume_${targetPath}_action`]: volumeActionAnswer.action
                            });

                            if (volumeActionAnswer.action === 'emptyDir') {
                                const { bindMount, cache: newCache } = await promptMountLocation(processedName, targetPath, cache);
                                manifest.services[processedName].binds.push(bindMount);
                                cache = newCache;  // 更新缓存
                            }
                            continue;
                        }

                        sourcePath = volumeParts[0];
                        targetPath = volumeParts[1];

                        // 检查是否是命名卷
                        const isNamedVolume = sourcePath && !sourcePath.startsWith('./') && !sourcePath.startsWith('../') && 
                            !sourcePath.startsWith('/') && !sourcePath.startsWith('~') && !path.isAbsolute(sourcePath);

                        if (isNamedVolume) {
                            // 询问用户如何处理命名卷
                            const volumeActionAnswer = await inquirer.prompt([{
                                type: 'list',
                                name: 'action',
                                message: `如何处理命名卷 ${sourcePath}:${targetPath}？`,
                                choices: [
                                    { name: '挂载空目录', value: 'emptyDir' },
                                    { name: '忽略挂载', value: 'ignore' }
                                ],
                                default: cache[`${processedName}_volume_${sourcePath}_${targetPath}_action`] || 'emptyDir'
                            }]);

                            // 更新缓存
                            cache = await updateCache(cache, {
                                [`${processedName}_volume_${sourcePath}_${targetPath}_action`]: volumeActionAnswer.action
                            });

                            if (volumeActionAnswer.action === 'emptyDir') {
                                const { bindMount, cache: newCache } = await promptMountLocation(processedName, targetPath, cache);
                                manifest.services[processedName].binds.push(bindMount);
                                cache = newCache;  // 更新缓存
                            }
                            continue;
                        }

                        // 处理源路径中的波浪号
                        if (sourcePath && sourcePath.startsWith('~')) {
                            sourcePath = sourcePath.replace('~', process.env.HOME || process.env.USERPROFILE);
                        }

                        // 检查目录是否存在
                        let choices = [
                            { name: '挂载空目录', value: 'emptyDir' },
                            { name: '忽略挂载', value: 'ignore' }
                        ];

                        let absoluteSourcePath;
                        if (sourcePath) {
                            absoluteSourcePath = path.resolve(executionDir, sourcePath);
                            const exists = await fs.pathExists(absoluteSourcePath);
                            if (exists) {
                                choices.unshift({ name: '使用目录内容', value: 'useContent' });
                            }
                        }

                        // 询问用户如何处理挂载
                        const volumeActionAnswer = await inquirer.prompt([{
                            type: 'list',
                            name: 'action',
                            message: `如何处理挂载点 ${targetPath}？`,
                            choices: choices,
                            default: cache[`${processedName}_volume_${targetPath}_action`] || (sourcePath ? 'useContent' : 'emptyDir')
                        }]);

                        // 更新缓存
                        cache = await updateCache(cache, {
                            [`${processedName}_volume_${targetPath}_action`]: volumeActionAnswer.action
                        });

                        if (volumeActionAnswer.action === 'useContent' && sourcePath) {
                            // 对于相对路径或绝对路径，使用 /lzcapp/pkg/content 中的内容
                            const relativePath = path.relative(executionDir, absoluteSourcePath);
                            // 使用 posix 风格路径
                            const posixPath = relativePath.split(path.sep).join(path.posix.sep);
                            manifest.services[processedName].binds.push(`/lzcapp/pkg/content/${posixPath}:${targetPath}`);
                        } else if (volumeActionAnswer.action === 'emptyDir') {
                            const { bindMount, cache: newCache } = await promptMountLocation(processedName, targetPath, cache);
                            manifest.services[processedName].binds.push(bindMount);
                            cache = newCache;  // 更新缓存
                        }
                    }
                }
            }

            // 处理 healthcheck 配置
            if (service.healthcheck) {
                // 如果 healthcheck 被禁用
                if (service.healthcheck.disable === true) {
                    manifest.services[processedName].health_check = {
                        disable: true
                    };
                } else {
                    const healthCheck = {};

                    // 处理测试命令
                    if (service.healthcheck.test) {
                        if (Array.isArray(service.healthcheck.test)) {
                            healthCheck.test = service.healthcheck.test.map(cmd => 
                                processEnvVariables(cmd, envConfig)
                            );
                        } else if (typeof service.healthcheck.test === 'string') {
                            // 如果是字符串，拆分成数组
                            healthCheck.test = [processEnvVariables(service.healthcheck.test, envConfig)];
                        }
                    }

                    // 处理 start_period
                    if (service.healthcheck.start_period) {
                        // 确保时间格式正确（支持 10s, 1m 等格式）
                        let startPeriod = service.healthcheck.start_period;
                        if (typeof startPeriod === 'string') {
                            // 已经是字符串格式，直接使用
                            healthCheck.start_period = startPeriod;
                        } else if (typeof startPeriod === 'number') {
                            // 如果是数字，假设是秒数，转换为字符串格式
                            healthCheck.start_period = `${startPeriod}s`;
                        }
                    }

                    // 如果有 test_url 配置（这是一个扩展配置）
                    if (service.healthcheck.test_url) {
                        healthCheck.test_url = processEnvVariables(service.healthcheck.test_url, envConfig);
                    }

                    // 添加到服务配置中
                    manifest.services[processedName].health_check = healthCheck;
                }
            }
        }

        // 写入 manifest.yml
        await fs.writeFile('manifest.yml', YAML.stringify(manifest));

        // 复制图标文件，如果源文件和标文件不同才复制
        const iconDestPath = path.join(process.cwd(), 'icon.png');
        if (path.resolve(options.icon) !== path.resolve(iconDestPath)) {
            await fs.copy(options.icon, iconDestPath);
        }

        // 创建 lpk 文件
        const output = fs.createWriteStream(`${answers.package}.lpk`);
        const archive = archiver('zip');

        archive.pipe(output);
        archive.file('manifest.yml', { name: 'manifest.yml' });
        archive.file('icon.png', { name: 'icon.png' });

        // 将 content.tar 添加到压缩包
        archive.file('content.tar', { name: 'content.tar' });

        await archive.finalize();

        // 清理临时文件
        await fs.remove('content.tar');

        console.log(`\n转换完成！已生成应用包：${answers.package}.lpk`);
    } catch (error) {
        // 确保清理临时文件
        try {
            await fs.remove('content.tar');
        } catch (cleanupError) {
            console.error('清理临时文件失败:', cleanupError);
        }
        throw new Error(`处理文件时出错：${error.message}`);
    }
}

// 将询问挂载位置的逻辑抽取成一个函数
async function promptMountLocation(name, targetPath, cache) {
    // 询问用户选择挂载位置
    const mountLocationAnswer = await inquirer.prompt([{
        type: 'list',
        name: 'location',
        message: `请选择 ${targetPath} 的挂载位置：`,
        choices: [
            { name: '应用内部数据目录 (/lzcapp/var)', value: 'app_data' },
            { name: '用户文稿数据目录 (/lzcapp/run/mnt/home)', value: 'user_data' }
        ],
        default: cache[`${name}_volume_${targetPath}_location`] || 'app_data'
    }]);

    // 更新缓存并获取新的缓存对象
    cache = await updateCache(cache, {
        [`${name}_volume_${targetPath}_location`]: mountLocationAnswer.location
    });

    if (mountLocationAnswer.location === 'app_data') {
        // 挂载应用内部数据目录
        return {
            bindMount: `/lzcapp/var/${path.basename(targetPath)}:${targetPath}`,
            cache
        };
    } else {
        // 询问用户文稿数据录的子目录名称
        const subDirAnswer = await inquirer.prompt([{
            type: 'input',
            name: 'subdir',
            message: '请输入用户文稿数据目录下的子目录名称：',
            default: cache[`${name}_volume_${targetPath}_subdir`] || path.basename(targetPath),
            validate: input => {
                if (!input.trim()) return '子目录名称不能为空';
                if (input.includes('/')) return '子目录名称不能包含斜杠';
                return true;
            }
        }]);

        // 更新缓存并获取新的缓存对象
        cache = await updateCache(cache, {
            [`${name}_volume_${targetPath}_subdir`]: subDirAnswer.subdir
        });

        // 挂载到用户文稿数据目录
        return {
            bindMount: `/lzcapp/run/mnt/home/${subDirAnswer.subdir}:${targetPath}`,
            cache
        };
    }
}

// Add this function to handle global config
async function loadGlobalConfig() {
    try {
        const configPath = path.join(os.homedir(), '.lzc-dtl.json');
        if (await fs.pathExists(configPath)) {
            return await fs.readJson(configPath);
        }
    } catch (error) {
        console.warn('读取全局配置失败:', error.message);
    }
    return {};
}

// Add this function to save global config
async function saveGlobalConfig(config) {
    try {
        const configPath = path.join(os.homedir(), '.lzc-dtl.json');
        await fs.writeJson(configPath, config, { spaces: 2 });
    } catch (error) {
        console.warn('保存全局配置失败:', error.message);
    }
}

// 修改 processImage 函数
async function processImage(imageName, packageName, cache, globalConfig, serviceName) {
    // 生成缓存键
    const imageKey = `image_${imageName.replace(/[/:]/g, '_')}`;
    
    // 检查缓存
    if (cache[imageKey]?.newImageName) {
        const useCacheAnswer = await inquirer.prompt([{
            type: 'confirm',
            name: 'useCache',
            message: `[${serviceName}] 发现已缓存的镜像配置，是否使用？`,
            default: true
        }]);

        if (useCacheAnswer.useCache) {
            console.log(`[${serviceName}] 使用缓存的镜像配置: ${cache[imageKey].newImageName}`);
            return cache[imageKey].newImageName;
        }
    }
    
    // 询问推送目标
    const pushTargetAnswer = await inquirer.prompt([{
        type: 'list',
        name: 'target',
        message: `[${serviceName}] 请选择镜像推送目标：`,
        choices: [
            { name: '不推送，直接使用原始镜像', value: 'none' },
            { name: '推送到自定义镜像仓库', value: 'custom' },
            { name: '推送到懒猫微服官方镜像源', value: 'lazycat' }
        ],
        default: cache[imageKey]?.pushTarget || 'none'
    }]);

    // 更新缓存
    let imageCache = {
        ...(cache[imageKey] || {}),
        originalImage: imageName,
        pushTarget: pushTargetAnswer.target
    };
    
    cache = await updateCache(cache, {
        [imageKey]: imageCache
    });
    
    // 如果选择推送，直接返回原始镜像
    if (pushTargetAnswer.target === 'none') {
        return imageName;
    }
    
    // 果选择推送到懒猫微服官方镜像源
    if (pushTargetAnswer.target === 'lazycat') {
        console.log(`[${serviceName}] 正在推送镜像到懒猫微服官方镜像源...`);
        const result = await execCommand(`lzc-cli appstore copy-image ${imageName}`);
        
        // 打印完整输出以便调试
        console.log('命令输出:', result.stdout);
        if (result.stderr) {
            console.log('错误输出:', result.stderr);
        }
        
        const match = result.stdout.match(/lazycat-registry: (.*)/);
        if (!match) {
            throw new Error('无法从输出中获取懒猫微服镜像地址，请检查 lzc-cli 命令输出');
        }
        const lazycatImage = match[1].trim();
        
        // 更新缓存
        imageCache = {
            ...imageCache,
            newImageName: lazycatImage,
            timestamp: new Date().toISOString()
        };
        
        cache = await updateCache(cache, {
            [imageKey]: imageCache
        });
        
        return lazycatImage;
    }
    
    // 处理自定义镜像仓库的情况
    let registryUrl = cache.registryUrl;
    if (!registryUrl && globalConfig.registryUrl) {
        registryUrl = globalConfig.registryUrl;
    }
    
    if (!registryUrl) {
        const registryAnswer = await inquirer.prompt([{
            type: 'input',
            name: 'url',
            message: '请输入远程仓库地址：',
            validate: input => input.trim() ? true : '仓库地址不能���空'
        }]);
        
        registryUrl = registryAnswer.url;
        
        const saveGloballyAnswer = await inquirer.prompt([{
            type: 'confirm',
            name: 'save',
            message: '是否要全局保存该仓库地址？',
            default: true
        }]);
        
        if (saveGloballyAnswer.save) {
            await saveGlobalConfig({ ...globalConfig, registryUrl });
        }
        
        cache = await updateCache(cache, { registryUrl });
    }
    
    // 生成新的镜像名称并推送
    const packageBaseName = packageName.split('.').pop();
    const imageHash = crypto.createHash('md5').update(imageName).digest('hex');
    const newImageName = `${registryUrl}/${packageBaseName}:${imageHash}`;
    
    console.log(`[${serviceName}] 正在拉取原始镜像: ${imageName}`);
    await execCommand(`docker pull ${imageName}`);
    
    console.log(`[${serviceName}] 正在标记镜像: ${newImageName}`);
    await execCommand(`docker tag ${imageName} ${newImageName}`);
    
    console.log(`[${serviceName}] 正在推送镜像到远程仓库: ${newImageName}`);
    await execCommand(`docker push ${newImageName}`);
    
    // 更新缓存
    imageCache = {
        ...imageCache,
        newImageName,
        timestamp: new Date().toISOString()
    };
    
    cache = await updateCache(cache, {
        [imageKey]: imageCache
    });
    
    return newImageName;
}

// 修改 execCommand 函数
async function execCommand(command) {
    const { exec } = require('child_process');
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`执行命令失败: ${error.message}`));
                return;
            }
            // 同时返回 stdout 和 stderr
            resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
        });
    });
}

module.exports = { convertApp }; 