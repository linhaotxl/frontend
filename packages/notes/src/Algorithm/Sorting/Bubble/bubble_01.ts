function bubble<T> ( array: T[] ): T[] {
    const result = Array.prototype.slice.call( array );
    const length = result.length;
    let temp: T  = null;

    for ( let i = length - 1; i > 0; --i ) {
        for ( let j = 0; j < i - 1; ++j ) {
            if ( result[ j ] > result[ j + 1 ] ) {
                temp = result[ j ];
                result[ j ] = result[ j + 1 ];
                result[ j + 1 ] = temp;
            }
        }
    }

    return result;
}

export default function start () {
    console.log( bubble([ 2, 9, 0, 76, 89, 21, 13, 67 ]) );
}