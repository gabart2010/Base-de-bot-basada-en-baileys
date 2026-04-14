export const delay = (ms) => delayCancellable(ms).delay;
export const delayCancellable = (ms) => {
    const stack = new Error().stack;
    let timeout;
    let reject;
    const delay = new Promise((resolve, _reject) => {
        timeout = setTimeout(resolve, ms);
        reject = _reject;
    });
    const cancel = () => {
        clearTimeout(timeout);
        reject(new Boom('Cancelled', {
            statusCode: 500,
            data: {
                stack
            }
        }));
    };
    return { delay, cancel };
};