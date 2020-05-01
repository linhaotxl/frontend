export const p1 = ( time: number = 1000 ) => new Promise<number>( resolve => {
    setTimeout(() => {
        resolve( 1 );
    }, 1000)
});

export const p2 = () => new Promise<number>( resolve => {
    setTimeout(() => {
        resolve( 2 );
    }, 2000)
});

export const p3 = () => new Promise<number>( resolve => {
    setTimeout(() => {
        resolve( 3 );
    }, 3000)
});

export const p4 = ( time: number ) => new Promise<void>(( _, reject ) => {
    setTimeout(() => {
        reject( 'p4 失败' );
    }, time);
})