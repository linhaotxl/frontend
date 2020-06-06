import Twm, { IMiddleware, TwmOptions } from '../TwmWatcher';

// 第一步：找到代码中的 import 语句，且 from 的内容不是相对路径
// 第二步：从上步结果中，

export default class NodeModulesPlugin implements IMiddleware {
    apply ( twm: Twm, options: TwmOptions ) {
        twm.translateHooks.tapPromise( 'NodeModules', ( context: IContext ) => new Promise( resolve => {
            resolve( context );
        }));
    }


}