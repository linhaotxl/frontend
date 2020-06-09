import rf from 'rimraf';

import Twm, { IMiddleware } from "../TwmWatcher";

export class ClearOutputFilePlugin implements IMiddleware {
    apply ( twm: Twm ) {
        twm.hooks.clearFileHooks.tapPromise( 'ClearOutputFile', ( context: ContextResource ) => new Promise( async resolve => {
            await this.execClearCommand( context.outputPath );
            resolve();
        }));
    }


    /**
     * 删除指定路径下的所有文件
     * @param { string } path 删除路径
     */
    execClearCommand ( path: string ) {
        return new Promise(( resolve, reject ) => {
            rf( path, ( err ) => {
                if ( err ) {
                    reject( false );
                }
                resolve( true );
            });
        });
    }
}