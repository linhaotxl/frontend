import { execSync } from 'child_process';

import Twm, { IMiddleware } from "../TwmWatcher";
import { ELang } from '../utils/Build';
import { joinPath } from '../utils/PathUtils';

const TS_FILE_EXT_NAME = '.ts';

export class TranslateTSPlugin implements IMiddleware {
    apply ( twm: Twm ) {
        twm.hooks.changeFileHooks.tapPromise( 'TranslateTS', ( context: ContextResource, fileResources: FileResource[] ) => new Promise( resolve => {
            this.resolveExecCommand( context, fileResources );
            resolve();
        }));
    }

    /**
     * 解析是否执行 ts 编译命令
     * @param { ContextResource } context       上下文对象
     * @param { FileResource[] }  fileResources 修改的文件列表
     */
    resolveExecCommand ( context: ContextResource, fileResources: FileResource[] ) {
        // 修改的文件列表里存在 ts 文件才需要执行
        // 或者第一次处于 ts 环境下
        if ( Array.isArray( fileResources ) && fileResources.length ) {
            if ( fileResources.some( f => f.extname === TS_FILE_EXT_NAME ) ) {
                this.execTSCCommand( context );
            }
        } else if ( context.lang === ELang.TS ) {
            this.execTSCCommand( context );
        }
    }

    /**
     * 执行 ts 编译命令
     * @param { ContextResource } context 上下文对象
     */
    execTSCCommand ( context: ContextResource ) {
        const { inputPath } = context;
        const tsConfigPath: string = joinPath( inputPath, 'tsconfig.json' );
        const cmd: string = `node ${ inputPath }/node_modules/typescript/lib/tsc.js -p ${ tsConfigPath }`;
        try {
            execSync( cmd );
        } catch ( e ) {
            console.log( 'err -> ', e.message )
        }
    }
}