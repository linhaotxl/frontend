import globby from 'globby';

import Twm, { IMiddleware } from '../TwmWatcher';
import { joinPath, relativePath, dirname, basename } from '../utils/PathUtils';
import { ContextResource } from '../Resource/ContextResource';
import { FileResource } from '../Resource/FileResource';
// import { ELang } from '../utils/Build';
// import { generateFileSourceMap } from '../helper/GenerateFileSourceMap';

const ONLY_COPY = /(\.lock$)|(node_modules)|(typings)/;

export class GlobbyPathPlugin implements IMiddleware {
    apply ( twm: Twm ) {
        twm.hooks.globbyFileHooks.tapPromise( 'GlobbyPath', ( context: ContextResource ) => new Promise( async resolve => {
            const { inputPath, outputPath, extensions, buildPath } = context;
            const { fileResourceMap, fileResources } = await this.generateFileSourceMap(
                joinPath( inputPath, '/**' ),
                inputPath,
                buildPath,
                outputPath,
                extensions,
                context
            );
            context.set( 'fileResourceMap', fileResourceMap );
            context.set( 'fileResources', fileResources );
            console.log( 11, fileResourceMap.translateMap )
            resolve( context );
        }));
    }

    async generateFileSourceMap (
        globbyPath: string | string[],
        input: string,
        include: string,
        output: string,
        extensions: IExtension[],
        context: ContextResource
    ) {
        const path = typeof globbyPath === 'string' ? [ globbyPath ] : globbyPath;
        const paths = await globby([ ...path, `!${ output }` ]);
        const fileResources: FileResource[] = [];
        const extReplaces = extensions.map( e => e.replace ).filter( Boolean ); // .js
    
        const fileResourceMap = paths.reduce<FileResourceMap>(( prev, curr ) => {
            const fileSource = new FileResource(
                curr,
                joinPath( output, relativePath( input, curr ) )
            );
    
            // 只需要第一次拷贝的目录文件
            if ( ONLY_COPY.test( fileSource.sourceAbsolutePath ) ) {
                prev.onlyCopy.push( fileSource );
                return prev;
            }
    
            fileResources.push( fileSource );
    
            // const isTs = context.lang === ELang.TS;
            // if ( isTs && fileSource.extname === '.js' ) {
            //     return prev;
            // }
    
            const ext = extensions.find( e => e.extname === fileSource.extname );
            const included = fileSource.sourceAbsolutePath.includes( include );

            // if ( ext && ext.replace ) {
            //     return prev;
            // }

            // 如果是 ts 文件，则要生成对应的 js 文件
            // 如果是 js 文件，则用本身 js 文件
            // 指定扩展名下，需要 babel 解析的文件
            if ( ext ) {
                const dir = dirname( fileSource.sourceAbsolutePath );
                const noExtName = basename( fileSource.filename, fileSource.extname );
                const path = joinPath( dir, noExtName + ext.replace );

                // 如果当前是 ts 文件，path 是 ts 对应的 js 文件
                // 如果当前是 js 文件，path 是没有后缀的文件
                // .ts -> .js
                // { extname: '.ts', replace: '.js' }  
                // { extname: '.js', replace: '' }  
                // .less -> .css
                // { extname: '.less', replace: '.css' }

                // .js -> .js
                // { extname: '.js', replace: '' }  

                if ( extReplaces.includes( ext.extname ) ) {
                    return prev;
                }
    
                const f = ext.replace
                    ? new FileResource( path, joinPath( output, relativePath( input, path ) ) )
                    : fileSource;
                
                if ( included ) {
                    console.log( 'ok -> ', curr, fileSource.sourceAbsolutePath )
                }
                    
                included
                    ? prev.translateMap.set( fileSource, f )
                    : prev.normalMap.set( fileSource, f );
                return prev;
            }
    
            // 除了以上之外，剩余的文件
            prev.modification.push( fileSource );
    
            return prev;
    
        }, { modification: [], translateMap: new Map(), normalMap: new Map(), onlyCopy: [] } as FileResourceMap);
    
        return { fileResources, fileResourceMap };
    }
}