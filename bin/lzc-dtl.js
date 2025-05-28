#!/usr/bin/env node

const { program } = require('commander');
const { convertApp } = require('../src/index');

program
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
    .parse(process.argv);

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