import globby from 'globby';

import Twm, { IMiddleware } from '../TwmWatcher';
import { FileResource } from '../Resource/FileResource';
import { joinPath, relativePath, dirname, basename } from '../utils/PathUtils';

const ONLY_COPY = /(\.lock$)|(node_modules)|(typings)/;

export class GlobbyPathPlugin implements IMiddleware {
    apply ( twm: Twm ) {
        twm.hooks.globbyFileHooks.tapPromise( 'GlobbyPath', ( context: ContextResource ) => new Promise( async resolve => {
            const { inputPath, outputPath, extensions, buildPath } = context;
            const { fileResourceMap, fileResources } = await this.createFileSource(
                joinPath( inputPath, '/**' ),
                inputPath,
                buildPath,
                outputPath,
                extensions,
            );
            context.set( 'fileResourceMap', fileResourceMap );
            context.set( 'fileResources', fileResources );

            resolve( context );
        }));
    }

    /**
     * 创建文件对象
     * @param { string | string[] } globbyPath  扫描目录
     * @param { string }            input       根路径
     * @param { string }            include     执行路径下需要翻译
     * @param { string }            output      输入路径
     * @param { IExtension[] }      extensions  配置扩展列表
     */
    async createFileSource (
        globbyPath: string | string[],
        input: string,
        include: string,
        output: string,
        extensions: IExtension[],
    ) {
        // 获取扫描目录
        const paths = await this.globbyNotOutputPaths( globbyPath, output );
        // 保存可能会修改的文件集合
        const fileResources: FileResource[] = [];
        // 获取需要翻译文的文件，翻译后的扩展集合
        const extReplaces = extensions.map( e => e.replace ).filter( Boolean ); // .js
    
        // 遍历扫描目录
        const fileResourceMap = paths.reduce<FileResourceMap>(( prev, curr ) => {
            // 生成文件对象
            const fileSource = new FileResource(
                curr,
                joinPath( output, relativePath( input, curr ) )
            );
    
            // 检测文件是否只会拷贝，不会修改，放入 onlyCopy 中
            if ( ONLY_COPY.test( fileSource.sourceAbsolutePath ) ) {
                prev.onlyCopy.push( fileSource );
                return prev;
            }
    
            // 存入当前文件
            fileResources.push( fileSource );
    
            // 获取当前文件的扩展对象
            const ext = extensions.find( e => e.extname === fileSource.extname );
            // 检测当前文件是否在指定目录下
            const included = fileSource.sourceAbsolutePath.includes( include );

            if ( ext ) {
                // 存在扩展，是需要翻译的

                const dir = dirname( fileSource.sourceAbsolutePath );
                // 文件名，不带有扩展
                const noExtName = basename( fileSource.filename, fileSource.extname );
                // 生成文件的目录地址
                const path = joinPath( dir, noExtName + ext.replace );

                // 如果当前文件扩展处于 extReplaces 中，则说明当前文件是翻译后的文件，a.js，是不需要存入的
                // 之前在解析 a.ts 的时候已经存入了
                // a.ts -> a.js
                if ( extReplaces.includes( ext.extname ) ) {
                    return prev;
                }
    
                // 如果当前文件不需要翻译，则使用原来的文件对象，否则创建新的
                const f = ext.replace
                    ? new FileResource( path, joinPath( output, relativePath( input, path ) ) )
                    : fileSource;
                
                // 根据当前文件是否处于指定目录下（ 是否需要翻译 ），存放于普通的字段中
                included
                    ? prev.translateMap.set( fileSource, f )
                    : prev.normalMap.set( fileSource, f );

                return prev;
            }
    
            // 如果当前文件不在扩展列表中，则放入普通文件 modification 字段中
            prev.modification.push( fileSource );
    
            return prev;
    
        }, { modification: [], translateMap: new Map(), normalMap: new Map(), onlyCopy: [] } as FileResourceMap);
    
        return { fileResources, fileResourceMap };
    }

    async globbyNotOutputPaths ( globbyPath: string | string[], output: string ) {
        const path = typeof globbyPath === 'string' ? [ globbyPath ] : globbyPath;
        return await globby([ ...path, `!${ output }` ])
    }
}