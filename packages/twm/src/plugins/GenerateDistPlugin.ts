import Twm, { IMiddleware } from "../TwmWatcher";
import { copyFile, writeFile } from '../utils/FsUtils';

export class GenerateDistPlugin implements IMiddleware {
    apply ( twm: Twm ) {
        twm.hooks.changeFileHooks.tapPromise( 'CopyFile', ( context: ContextResource, fileResources: FileResource[] ) => new Promise( async resolve => {
            await this.resolveGenerateDist( context, fileResources );
            resolve( context );
        }));
    }

    /**
     * 解析源文件生成目标文件
     * @param { ContextResource } context           上下文对象
     * @param { FileResource[] }  fileResources     修改文件列表
     */
    async resolveGenerateDist ( context: ContextResource, fileResources: FileResource[] ) {
        const { fileResourceMap: { onlyCopy, translateMap, normalMap, modification } } = context;
        let copyFiles  = new Set<FileResource>();
        let writeFiles = new Set<FileResource>();

        if ( Array.isArray( fileResources ) && fileResources.length ) {
            // 有改动的文件，遍历改动文件列表
            fileResources.forEach( changeFile => {
                // 处理需要翻译的文件
                const sourceFile = translateMap.get( changeFile );
                if ( sourceFile ) {
                    return this.translateFileUpdate( changeFile, sourceFile, copyFiles, writeFiles );
                }

                // 处理不需要翻译的文件
                const normalFile = normalMap.get( changeFile );
                if ( normalFile ) {
                    return this.normalFileUpdate( changeFile, normalFile, copyFiles );
                }

                // 处理普通文件
                const modifyFile = modification.find( m => m.sourceAbsolutePath === changeFile.sourceAbsolutePath);
                if ( modifyFile ) {
                    return this.modifyFileUpdate( modifyFile, copyFiles );
                }
            });

        } else {
            // 第一次编译，将不需要翻译的文件全部放入 copy 数组中
            copyFiles = new Set([ ...onlyCopy, ...modification, ...[ ...normalMap ].flat() ])
            // 将需要翻译源文件放入 copy，翻译后的文件放入 write 中
            this.traversalTranslateFile( translateMap, writeFiles, copyFiles );
        }

        await this.copyFiles( copyFiles );
        await this.writeFiles( writeFiles );
    }

    /**
     * 更新需要翻译的文件，翻译后的文件需要 write，而源文件需要 copy
     * @param { FileResource } targetFile 翻译后的目标文件
     * @param { FileResource } sourceFile 源文件
     * @param { Set<FileResource> } copyFiles 需要 copy 的文件集合
     * @param { Set<FileResource> } writeFiles 需要 write 的文件集合
     */
    translateFileUpdate (
        sourceFile: FileResource,
        targetFile: FileResource,
        copyFiles: Set<FileResource>,
        writeFiles: Set<FileResource>
    ) {
        // 目标文件需要 write，所以存入 write 集合
        writeFiles.add( targetFile );
        if ( targetFile !== sourceFile ) {
            // 此时源文件不需要变动，但是需要 copy
            copyFiles.add( sourceFile );
        }
    }

    /**
     * 更新不需要翻译的文件
     * @param { FileResource } targetFile 翻译后的目标文件
     * @param { FileResource } sourceFile 源文件
     * @param { Set<FileResource> } copyFiles 需要 copy 的文件集合
     */
    normalFileUpdate (
        targetFile: FileResource,
        sourceFile: FileResource,
        copyFiles: Set<FileResource>,
    ) {
        // 将源文件和目标文件都存入 copyFiles 集合中
        // 如果是相同扩展的文件，也只会加一个，如果不同，则两种都是需要 copy 的
        copyFiles.add( targetFile );
        copyFiles.add( sourceFile );
    }

    /**
     * 更新普通文件
     * @param { FileResource } modifyFile 修改的普通文件
     * @param { Set<FileResource> } copyFiles 需要 copy 的文件集合
     */
    modifyFileUpdate ( modifyFile: FileResource, copyFiles: Set<FileResource> ) {
        // 普通文件仅仅需要 copy 到生成目录下
        copyFiles.add( modifyFile );
    }

    /**
     * 遍历翻译文件，将源文件存入 copyFiles，翻译后的文件存入 writeFiles
     * @param { Map<FileResource, FileResource> } maps  翻译文件集合
     * @param { Set<FileResource> } writeFiles          需要 write 文件集合
     * @param { Set<FileResource> } copyFiles           需要 copy  文件集合
     */
    traversalTranslateFile (
        maps: Map<FileResource, FileResource>,
        writeFiles: Set<FileResource>,
        copyFiles: Set<FileResource>
    ) {
        for ( const [ source, target ] of maps.entries() ) {
            writeFiles.add( target );
            copyFiles.add( source )
        }
    }

    /**
     * copy 文件
     * @param { Set<FileResource> } files copy 文件集合
     */
    async copyFiles ( files: Set<FileResource> ) {
        files.forEach( async file => {
            await copyFile( file.sourceAbsolutePath, file.distAbsolutePath );
        });
    }

    /**
     * write 文件
     * @param { Set<FileResource> } files write 文件集合
     */
    async writeFiles ( files: Set<FileResource> ) {
        files.forEach( async file => {
            await writeFile( file.distAbsolutePath, file.sourceCode );
        });
    }
}