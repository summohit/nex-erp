/**
 * Suggested task locations: India's states and union territories, each with
 * its principal cities. Only suggestions — the admin picks which to add, and
 * anything missing can still be added by hand as a single location.
 */
export const INDIA_LOCATIONS: Record<string, string[]> = {
  // States
  'Andhra Pradesh': ['Amaravati', 'Visakhapatnam', 'Vijayawada', 'Guntur', 'Nellore', 'Kurnool', 'Tirupati', 'Kakinada', 'Rajahmundry', 'Kadapa', 'Anantapur', 'Eluru', 'Ongole', 'Srikakulam', 'Vizianagaram'],
  'Arunachal Pradesh': ['Itanagar', 'Naharlagun', 'Pasighat', 'Tawang', 'Ziro', 'Bomdila', 'Tezu', 'Along'],
  'Assam': ['Guwahati', 'Dispur', 'Dibrugarh', 'Jorhat', 'Silchar', 'Tezpur', 'Nagaon', 'Tinsukia', 'Bongaigaon', 'Dhubri', 'Diphu', 'Golaghat', 'Sivasagar'],
  'Bihar': ['Patna', 'Gaya', 'Bhagalpur', 'Muzaffarpur', 'Darbhanga', 'Purnia', 'Arrah', 'Begusarai', 'Katihar', 'Munger', 'Chapra', 'Sasaram', 'Hajipur', 'Bihar Sharif', 'Motihari'],
  'Chhattisgarh': ['Raipur', 'Bhilai', 'Durg', 'Bilaspur', 'Korba', 'Rajnandgaon', 'Raigarh', 'Jagdalpur', 'Ambikapur', 'Dhamtari'],
  'Goa': ['Panaji', 'Margao', 'Vasco da Gama', 'Mapusa', 'Ponda', 'Bicholim', 'Curchorem'],
  'Gujarat': ['Gandhinagar', 'Ahmedabad', 'Surat', 'Vadodara', 'Rajkot', 'Bhavnagar', 'Jamnagar', 'Junagadh', 'Anand', 'Navsari', 'Morbi', 'Nadiad', 'Bharuch', 'Vapi', 'Mehsana', 'Gandhidham', 'Bhuj', 'Porbandar'],
  'Haryana': ['Chandigarh', 'Gurugram', 'Faridabad', 'Panipat', 'Ambala', 'Yamunanagar', 'Rohtak', 'Hisar', 'Karnal', 'Sonipat', 'Panchkula', 'Bhiwani', 'Sirsa', 'Rewari', 'Kurukshetra', 'Jind'],
  'Himachal Pradesh': ['Shimla', 'Dharamshala', 'Mandi', 'Solan', 'Kullu', 'Manali', 'Bilaspur', 'Hamirpur', 'Una', 'Chamba', 'Nahan', 'Kangra'],
  'Jharkhand': ['Ranchi', 'Jamshedpur', 'Dhanbad', 'Bokaro', 'Deoghar', 'Hazaribagh', 'Giridih', 'Ramgarh', 'Dumka', 'Phusro', 'Medininagar', 'Chaibasa'],
  'Karnataka': ['Bengaluru', 'Mysuru', 'Mangaluru', 'Hubballi', 'Dharwad', 'Belagavi', 'Kalaburagi', 'Davanagere', 'Ballari', 'Vijayapura', 'Shivamogga', 'Tumakuru', 'Udupi', 'Hassan', 'Raichur', 'Bidar', 'Mandya', 'Chitradurga'],
  'Kerala': ['Thiruvananthapuram', 'Kochi', 'Kozhikode', 'Thrissur', 'Kollam', 'Kannur', 'Alappuzha', 'Kottayam', 'Palakkad', 'Malappuram', 'Kasaragod', 'Pathanamthitta', 'Idukki', 'Wayanad'],
  'Madhya Pradesh': ['Bhopal', 'Indore', 'Jabalpur', 'Gwalior', 'Ujjain', 'Sagar', 'Dewas', 'Satna', 'Ratlam', 'Rewa', 'Murwara (Katni)', 'Singrauli', 'Burhanpur', 'Khandwa', 'Chhindwara', 'Vidisha', 'Guna', 'Shivpuri'],
  'Maharashtra': ['Mumbai', 'Pune', 'Nagpur', 'Thane', 'Nashik', 'Navi Mumbai', 'Aurangabad (Chhatrapati Sambhajinagar)', 'Solapur', 'Kolhapur', 'Amravati', 'Nanded', 'Sangli', 'Jalgaon', 'Akola', 'Latur', 'Ahmednagar (Ahilyanagar)', 'Dhule', 'Chandrapur', 'Parbhani', 'Satara', 'Ratnagiri', 'Kalyan-Dombivli', 'Vasai-Virar', 'Panvel'],
  'Manipur': ['Imphal', 'Thoubal', 'Bishnupur', 'Churachandpur', 'Ukhrul', 'Senapati', 'Kakching'],
  'Meghalaya': ['Shillong', 'Tura', 'Jowai', 'Nongstoin', 'Williamnagar', 'Baghmara'],
  'Mizoram': ['Aizawl', 'Lunglei', 'Champhai', 'Saiha', 'Kolasib', 'Serchhip'],
  'Nagaland': ['Kohima', 'Dimapur', 'Mokokchung', 'Tuensang', 'Wokha', 'Zunheboto', 'Mon'],
  'Odisha': ['Bhubaneswar', 'Cuttack', 'Rourkela', 'Berhampur', 'Sambalpur', 'Puri', 'Balasore', 'Bhadrak', 'Baripada', 'Jharsuguda', 'Angul', 'Koraput', 'Rayagada'],
  'Punjab': ['Chandigarh', 'Ludhiana', 'Amritsar', 'Jalandhar', 'Patiala', 'Bathinda', 'Mohali', 'Pathankot', 'Hoshiarpur', 'Moga', 'Firozpur', 'Kapurthala', 'Phagwara', 'Sangrur', 'Barnala'],
  'Rajasthan': ['Jaipur', 'Jodhpur', 'Udaipur', 'Kota', 'Ajmer', 'Bikaner', 'Bhilwara', 'Alwar', 'Bharatpur', 'Sikar', 'Pali', 'Sri Ganganagar', 'Tonk', 'Chittorgarh', 'Jaisalmer', 'Barmer', 'Hanumangarh', 'Beawar'],
  'Sikkim': ['Gangtok', 'Namchi', 'Gyalshing', 'Mangan', 'Rangpo', 'Singtam'],
  'Tamil Nadu': ['Chennai', 'Coimbatore', 'Madurai', 'Tiruchirappalli', 'Salem', 'Tirunelveli', 'Tiruppur', 'Vellore', 'Erode', 'Thoothukudi', 'Thanjavur', 'Dindigul', 'Hosur', 'Nagercoil', 'Kanchipuram', 'Karur', 'Cuddalore', 'Kumbakonam'],
  'Telangana': ['Hyderabad', 'Warangal', 'Nizamabad', 'Karimnagar', 'Khammam', 'Ramagundam', 'Mahbubnagar', 'Nalgonda', 'Adilabad', 'Siddipet', 'Suryapet', 'Miryalaguda', 'Secunderabad'],
  'Tripura': ['Agartala', 'Udaipur', 'Dharmanagar', 'Kailashahar', 'Belonia', 'Ambassa'],
  'Uttar Pradesh': ['Lucknow', 'Kanpur', 'Ghaziabad', 'Agra', 'Varanasi', 'Meerut', 'Prayagraj', 'Noida', 'Greater Noida', 'Bareilly', 'Aligarh', 'Moradabad', 'Saharanpur', 'Gorakhpur', 'Jhansi', 'Firozabad', 'Mathura', 'Ayodhya', 'Muzaffarnagar', 'Shahjahanpur', 'Rampur', 'Etawah', 'Sultanpur'],
  'Uttarakhand': ['Dehradun', 'Haridwar', 'Roorkee', 'Haldwani', 'Rudrapur', 'Kashipur', 'Rishikesh', 'Nainital', 'Almora', 'Pithoragarh', 'Mussoorie'],
  'West Bengal': ['Kolkata', 'Howrah', 'Durgapur', 'Asansol', 'Siliguri', 'Bardhaman', 'Kharagpur', 'Haldia', 'Malda', 'Baharampur', 'Krishnanagar', 'Darjeeling', 'Jalpaiguri', 'Cooch Behar', 'Bankura', 'Purulia'],
  // Union territories
  'Andaman and Nicobar Islands': ['Port Blair', 'Car Nicobar', 'Mayabunder', 'Diglipur', 'Rangat'],
  'Chandigarh': ['Chandigarh'],
  'Dadra and Nagar Haveli and Daman and Diu': ['Daman', 'Diu', 'Silvassa'],
  'Delhi': ['New Delhi', 'Central Delhi', 'North Delhi', 'South Delhi', 'East Delhi', 'West Delhi', 'North West Delhi', 'North East Delhi', 'South West Delhi', 'Shahdara', 'Dwarka', 'Rohini'],
  'Jammu and Kashmir': ['Srinagar', 'Jammu', 'Anantnag', 'Baramulla', 'Udhampur', 'Kathua', 'Sopore', 'Pulwama', 'Rajouri', 'Poonch'],
  'Ladakh': ['Leh', 'Kargil'],
  'Lakshadweep': ['Kavaratti', 'Agatti', 'Minicoy', 'Amini', 'Andrott'],
  'Puducherry': ['Puducherry', 'Karaikal', 'Mahe', 'Yanam'],
};

/** Union territories, so the picker can label them. */
export const INDIA_UNION_TERRITORIES = new Set([
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
]);

/** The suggested cities for a state, matched on its name regardless of case. */
export function suggestedCities(stateName: string): string[] {
  const key = Object.keys(INDIA_LOCATIONS).find((k) => k.toLowerCase() === stateName.trim().toLowerCase());
  return key ? INDIA_LOCATIONS[key] : [];
}
