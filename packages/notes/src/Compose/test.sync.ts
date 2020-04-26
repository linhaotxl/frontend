export const SyncMiddleware1 = ( context: any, next: Function ) => {
    console.log( 'Sync Middleware1 start.' );
    const result = next();
    console.log( 'Sync Middleware1 end.', result );
};

export const SyncMiddleware2 = ( context: any, next: Function ) => {
    console.log( 'Sync Middleware2 start.' );
    const result = next();
    console.log( 'Sync Middleware2 end.', result );
};

export const SyncMiddleware3 = ( context: any, next: Function ) => {
    console.log( 'Sync Middleware3 start.' );
    const result = next();
    console.log( 'Sync Middleware3 end.', result );
};

export const SyncMiddleware4 = ( context: any, next: Function ) => {
    console.log( 'Sync Middleware4 start.' );
    throw new Error( 'Sync Middleware4 Error.' );
};