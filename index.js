const UglifyES = require('uglify-es');
const Fs = require('fs');
const FsExtra = require('fs-extra');
const Path = require('path');
const HtmlMinifier = require('html-minifier');
const globby = require('globby');
const JsZip = require('jszip');

let ccPluginPacker = {
    _compressCode (jsFile, isMin) {
        if (Fs.existsSync(jsFile)) {
            let data = Fs.readFileSync(jsFile, 'utf-8');
            let result = UglifyES.minify(data, {
                compress: {
                    dead_code: true,// 移除未使用的code
                    drop_console: true,//丢弃console代码,默认false
                    drop_debugger: true,//丢弃debugger代码,默认true
                },
                output: {
                    // comments: false,
                }
            });
            if (result.error) {
                // console.log("❎压缩出现错误: " + result.error.message);
                // console.log("❎发生错误的文件: " + jsFile);
                return false;
            } else {
                if (isMin) {
                    let file = Path.basenameNoExt(jsFile);
                    file += '.min.js';
                    Fs.writeFileSync(file, result.code);
                } else {
                    Fs.writeFileSync(jsFile, result.code);
                }
                return true;
            }
        } else {
            console.log('文件不存在:' + jsFile);
            return false;
        }
    },
    _packageDir (rootPath, zip) {
        let dir = Fs.readdirSync(rootPath);
        for (let i = 0; i < dir.length; i++) {
            let itemDir = dir[i];
            let itemFullPath = Path.join(rootPath, itemDir);
            let stat = Fs.statSync(itemFullPath);
            if (stat.isFile()) {
                zip.file(itemDir, Fs.readFileSync(itemFullPath));
            } else if (stat.isDirectory()) {
                ccPluginPacker._packageDir(itemFullPath, zip.folder(itemDir));
            }
        }
    },
    // projectRootPath 项目根目录
    // dontCopyFile 不拷贝的文件
    // dontMinJs  不压缩的JS代码
    pack (options) {
        let dontCopyFile = options.filterFiles;
        if (dontCopyFile && Array.isArray(dontCopyFile)) {
        } else {
            dontCopyFile = [];
        }

        let dontMinJs = options.dontMinJs;
        if (dontMinJs && Array.isArray(dontMinJs)) {

        } else {
            dontMinJs = [];
        }

        if (!options.plugin || !Fs.existsSync(options.plugin)) {
            console.error(`[ERROR] 插件目录无效: ${options.plugin}`);
            return;
        }

        let pluginDirName = Path.basename(options.plugin); // 插件名字
        let packageDirPath = options.plugin;// 插件根目录
        let pluginOutPath = options.out;// 插件输出目录
        if (!pluginOutPath || pluginOutPath === '') {
            pluginOutPath = Path.join(Path.dirname(pluginDirName), 'out');
        }
        let pluginTmpPath = Path.join(pluginOutPath, pluginDirName);// 插件输出目录

        // 创建插件的输出目录
        FsExtra.ensureDirSync(pluginOutPath);
        FsExtra.ensureDirSync(pluginTmpPath);
        FsExtra.emptyDirSync(pluginTmpPath);


        // 补全路径
        let dontCopyFileArray = [];
        dontCopyFile.map((item) => {
            let full = Path.join(packageDirPath, item);
            if (Fs.existsSync(full)) {
                dontCopyFileArray.push(full);
            } else {
                console.warn('无效的过滤项: ' + item);
            }
        });


        // 可以在第三个参数,过滤掉不需要拷贝的文件
        // filter <Function>: Function to filter copied files. Return true to include, false to exclude.
        // 将插件先拷贝到out/pluginTmp目录下
        FsExtra.copySync(packageDirPath, pluginTmpPath, (file, dest) => {
            let isInclude = true;
            let state = Fs.statSync(file);
            if (state.isDirectory()) {
                // 文件夹,判断是否有这个文件夹
                for (let i = 0; i < dontCopyFileArray.length; i++) {
                    let itemFile = dontCopyFileArray[i];
                    if (Fs.statSync(itemFile).isDirectory() && itemFile === file) {
                        isInclude = false;
                        break;
                    }
                }
            } else if (state.isFile()) {
                // 文件 判断是否包含在文件夹内
                for (let i = 0; i < dontCopyFileArray.length; i++) {
                    let itemFile = dontCopyFileArray[i];
                    if (Fs.statSync(itemFile).isDirectory()) {
                        if (file.indexOf(itemFile) === -1) {
                        } else {
                            isInclude = false;
                            break;
                        }
                    } else if (Fs.statSync(itemFile).isFile()) {
                        if (itemFile === file) {
                            isInclude = false;
                            break;
                        }
                    }
                }
            }
            if (!isInclude) {
                if (Fs.statSync(file).isFile()) {
                    console.log('⚠[过滤] 文件: ' + file);
                } else if (Fs.statSync(file).isDirectory()) {
                    console.log('⚠[过滤] 目录: ' + file);
                }
            }
            return isInclude;
        });

        console.log('✅[拷贝] 拷贝插件到输出目录成功: ' + pluginTmpPath);
        // 删除掉package-lock.json
        let delFiles = ['package-lock.json', 'README.md'];
        for (let i = 0; i < delFiles.length; i++) {
            let packageLocalFilePath = Path.join(pluginTmpPath, delFiles[i]);
            if (Fs.existsSync(packageLocalFilePath)) {
                Fs.unlinkSync(packageLocalFilePath);
                console.log('✅[删除] 文件: ' + packageLocalFilePath);
            }
        }

        // 修改插件必要的配置package.json,
        let pluginTmpPackageCfgPath = Path.join(pluginTmpPath, 'package.json');// 插件临时配置文件路径
        if (!Fs.existsSync(pluginTmpPackageCfgPath)) {
            console.error('[ERROR] 没有发现配置的临时文件: ' + pluginTmpPackageCfgPath);
            return;
        }
        let cfgData = Fs.readFileSync(pluginTmpPackageCfgPath, 'utf-8');
        let json = JSON.parse(cfgData);
        // 删除无用的menu
        let menus = json['main-menu'];
        if (menus) {
            for (let key in menus) {
                let item = menus[key];
                if (item && item.del) {
                    delete menus[key];
                    console.log('✅[丢弃] 无用menus: ' + key);
                }
            }
        }
        // 删除dependencies
        let dependencies = json['dependencies'];
        if (dependencies) {
            delete json['dependencies'];
            console.log('✅[丢弃] 无用dependencies');
        }

        // 删除devDependencies
        let devDependencies = json['devDependencies'];
        if (devDependencies) {
            delete json['devDependencies'];
            console.log('✅[丢弃] 无用devDependencies');
        }

        let str = JSON.stringify(json);
        // str = jsBeautifully(str);// 格式化json
        Fs.writeFileSync(pluginTmpPackageCfgPath, str);

        console.log('✅[修改] 写入新的临时配置package.json完毕!');

        // 压缩js
        let exclude = '!' + pluginTmpPath + '/node_modules/**/*';
        let globbyOptions = [
            pluginTmpPath + '/**/*.js',
            exclude,
        ];
        for (let i = 0; i < dontMinJs.length; i++) {
            let item = dontMinJs[i];
            let fullUrl = Path.join(pluginTmpPath, item);
            if (Fs.existsSync(fullUrl)) {
                globbyOptions.push(`!${fullUrl}`);
                console.log('⚠[压缩配置] 新增禁止压缩配置: ' + item);
            } else {
                console.log('⚠[压缩配置] 无效的禁止压缩配置: ' + item);
            }
        }
        let paths = globby.sync(globbyOptions);
        for (let i = 0; i < paths.length; i++) {
            let item = paths[i];
            let b = ccPluginPacker._compressCode(item, false);
            if (b) {
                console.log(`✅[压缩] 成功(JS)[${i + 1}/${paths.length}]: ${item}`);
            } else {
                console.log(`❎[压缩] 失败(JS)[${i + 1}/${paths.length}]: ${item}`);
            }
        }

        // 压缩html,css
        let pattern2 = pluginTmpPath + '/**/*.html';
        let pattern3 = pluginTmpPath + '/**/*.css';
        let paths1 = globby.sync([pattern2, pattern3, exclude]);
        let minify = HtmlMinifier.minify;
        for (let i = 0; i < paths1.length; i++) {
            let item = paths1[i];
            let itemData = Fs.readFileSync(item, 'utf-8');
            let minifyData = minify(itemData, {
                removeComments: true,// 是否去掉注释
                collapseWhitespace: true,// 是否去掉空格
                minifyJS: false, //是否压缩html里的js（使用uglify-js进行的压缩）
                minifyCSS: false,//是否压缩html里的css（使用clean-css进行的压缩）
            });
            Fs.writeFileSync(item, minifyData);
            console.log(`✅[压缩] 成功(HTML)[${i + 1}/${paths1.length}]: ${item}`);
        }
        // 打包文件
        let zip = new JsZip();
        ccPluginPacker._packageDir(pluginTmpPath, zip.folder(pluginDirName));
        let zipFilePath = Path.join(pluginOutPath, `${pluginDirName}.zip`);
        if (Fs.existsSync(zipFilePath)) {
            Fs.unlinkSync(zipFilePath);
            console.log('⚠[删除] 旧版本压缩包: ' + zipFilePath);
        }
        zip.generateNodeStream({
            type: 'nodebuffer',
            streamFiles: true,
            compression: 'DEFLATE',
            compressionOptions: {
                level: 9
            }
        })
            .pipe(Fs.createWriteStream(zipFilePath))
            .on('finish', () => {
                console.log('✅[打包]成功!');
                if (options.show) {
                    ccPluginPacker._showFileInExplore(pluginOutPath);
                }
            })
            .on('error', () => {
                console.log('❌[打包]失败: ');
            });
    },

    // 在文件夹中展示打包文件
    _showFileInExplore (showPath) {
        let exec = require('child_process').exec;
        let platform = require('os').platform();
        let cmd = null;
        if (platform === 'darwin') {
            cmd = 'open ' + showPath;
        } else if (platform === 'win32') {
            cmd = 'explorer ' + showPath;
        }
        if (cmd) {
            console.log('😂[CMD] ' + cmd);
            exec(cmd, (error, stdout, stderr) => {
                if (error) {
                    console.log(stderr);
                } else {
                    // console.log(stdout);
                }
            });
        }
    }
};
module.exports = ccPluginPacker.pack;