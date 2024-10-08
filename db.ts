import { Pool } from "pg";
import dotenv from "dotenv";
dotenv.config();

const pool = new Pool({
	connectionString: process.env.DATABASE_URL,
});

export const query = async (text: string, params: (string | number)[]) => {
	try {
		const result = await pool.query(text, params);
		return result;
	} catch (error) {
		throw error;
	}
};


// const queryTest = async () => {
// 	const res = await query('SELECT * FROM "Lead"', []);
// 	console.log(res.rows);
// };

// queryTest();

export default pool;
