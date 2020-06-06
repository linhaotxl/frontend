import Watchpack, { WatchOptions } from 'watchpack';
import { ContextResource } from '../Resource/ContextResource';

export class FileWatcher {
    defaultOptions: WatchOptions = {
        aggregateTimeout: 300,
        ignored: /node_modules/,
        poll: true
    };
    wt: Watchpack = null;

    constructor ( options: WatchOptions, context: ContextResource ) {
        this.initialWatchPack( options, context );
    }

    initialWatchPack ( options: WatchOptions, context: ContextResource ) {
        const { fileResourceMap: { translateMap, normalMap, modification } } = context;
        const modificationPaths = modification.map<string>( m => m.sourceAbsolutePath );
        const translateMapPaths: string[] = [];
        const normalMapPaths: string[] = [];

        for ( const f of translateMap.keys() ) {
            translateMapPaths.push( f.sourceAbsolutePath );
        }

        for ( const f of normalMap.keys() ) {
            normalMapPaths.push( f.sourceAbsolutePath );
        }
        // const unResolvePaths: string[] = unresolve.map( resource => resource.sourceAbsolutePath );
        // const onlyWatchNotGlobbyPaths: string[] = onlyWatchNotGlobby.map( i => i.sourceAbsolutePath );
        // const resolvePaths: string[] = Object.keys( resolve ).reduce<string[]>(( prev, curr ) => {
        //     const fileResources = resolve[ curr ];
        //     return prev.concat( fileResources.map( resource => resource.sourceAbsolutePath ));
        // }, []);

        this.wt = new Watchpack( Object.assign( {}, this.defaultOptions, options ) );

        this.wt.watch(
            [ ...modificationPaths, ...translateMapPaths, ...normalMapPaths ],
            // [ ...resolvePaths, ...unResolvePaths, ...onlyWatchNotGlobbyPaths ],
            [],
        );
    }

    onAggregated ( onAggregated: ( changes: string[] ) => void ) {
        this.wt.on( 'aggregated', async ( changes: string[] ) => {
            onAggregated( changes );
        });
    }

}