import Scanner from '../../scanner-app';
export default async function Page({params}:{params:Promise<{token:string}>}){const {token}=await params;return <Scanner key={token} token={token}/>;}
