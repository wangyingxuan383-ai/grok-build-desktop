/** Local development hosts use HTTP; other bare hosts keep the HTTPS default. */
export function browserAddress(input:string):string {
 const value=input.trim();
 if(/^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(value))return `http://${value}`;
 return /^[a-z][a-z0-9+.-]*:/i.test(value)?value:`https://${value}`;
}
