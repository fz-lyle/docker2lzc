#!/usr/bin/env node

const { program } = require('commander');
const { convertApp } = require('../src/index');
const { spawn } = require('child_process');
const packageJson = require('../package.json');

program
    .version(packageJson.version, '-v, --version', '显示当前版本')
    .option('-n, --name <name>', '应用名称')
    .option('-p, --package <package>', '应用包名')
    .option('-d, --description <description>', '应用描述')
    .option('-h, --homepage <homepage>', '应用首页')
    .option('-a, --author <author>', '作者')
    .option('-b, --background-task [boolean]', '是否开机自启')
    .option('-m, --multi-instance [boolean]', '是否多用户共享')
    .option('--public-paths <paths>', '需要对外暴露的页面，用逗号分隔')
    .option('-s, --subdomain <subdomain>', '子域名')
    .option('-i, --icon <path>', '图标文件路径')
    .option('-c, --compose <path>', 'docker-compose.yml 文件路径')
    .option('--routes <routes>', '路由配置，JSON格式的路由数组')
    .option('--non-interactive', '非交互式模式，需要提供所有必要参数')
    .option('--update', '检查并更新到最新版本');

// 处理更新命令
if (process.argv.includes('--update')) {
    console.log('正在检查更新...');
    console.log(`当前版本: ${packageJson.version}`);
    
    const updateProcess = spawn('npm', ['install', '-g', 'docker2lzc@latest'], {
        stdio: 'inherit'
    });
    
    updateProcess.on('close', (code) => {
        if (code === 0) {
            console.log('\n✅ 更新完成！');
            console.log('请运行 docker2lzc --version 查看新版本');
        } else {
            console.error('\n❌ 更新失败，请手动执行: npm install -g docker2lzc@latest');
        }
        process.exit(code);
    });
    
    updateProcess.on('error', (error) => {
        console.error('❌ 更新失败:', error.message);
        console.log('请手动执行: npm install -g docker2lzc@latest');
        process.exit(1);
    });
    
    return;
}

program.parse(process.argv);

const options = program.opts();

// 转换布尔值
if (options.backgroundTask === 'true') options.backgroundTask = true;
if (options.backgroundTask === 'false') options.backgroundTask = false;
if (options.multiInstance === 'true') options.multiInstance = true;
if (options.multiInstance === 'false') options.multiInstance = false;

// 解析路由配置
if (options.routes) {
    try {
        options.routes = JSON.parse(options.routes);
    } catch (error) {
        console.error('路由配置格式错误，请提供有效的JSON字符串');
        process.exit(1);
    }
}

convertApp(options).catch(console.error);