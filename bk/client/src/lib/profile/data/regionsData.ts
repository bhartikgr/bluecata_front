/**
 * Sprint 21 Wave E — Cascading Country → State → City seed data.
 *
 * Full structured data for US, CA, UK, AU, SG, HK, IN, JP.
 * All other countries derive dial codes from COUNTRIES but have empty
 * states/cities arrays — those fields render as free-text Inputs.
 */

export interface RegionState {
  code: string;
  label: string;
  cities: string[];
}

export interface RegionEntry {
  label: string;
  dialCode: string;
  states: RegionState[];
}

export const REGIONS: Record<string, RegionEntry> = {
  US: {
    label: "United States",
    dialCode: "+1",
    states: [
      { code: "CA", label: "California", cities: ["Los Angeles", "San Francisco", "San Diego", "San Jose", "Sacramento", "Oakland", "Palo Alto", "Irvine", "Santa Monica", "Berkeley"] },
      { code: "NY", label: "New York", cities: ["New York City", "Buffalo", "Rochester", "Yonkers", "Syracuse", "Albany", "White Plains", "Brooklyn", "Queens", "Staten Island"] },
      { code: "TX", label: "Texas", cities: ["Houston", "Austin", "Dallas", "San Antonio", "Fort Worth", "El Paso", "Arlington", "Plano", "Lubbock", "Corpus Christi"] },
      { code: "FL", label: "Florida", cities: ["Miami", "Orlando", "Tampa", "Jacksonville", "St. Petersburg", "Fort Lauderdale", "Tallahassee", "Boca Raton", "Sarasota", "Naples"] },
      { code: "WA", label: "Washington", cities: ["Seattle", "Bellevue", "Redmond", "Kirkland", "Tacoma", "Spokane", "Vancouver", "Renton", "Everett", "Olympia"] },
      { code: "MA", label: "Massachusetts", cities: ["Boston", "Cambridge", "Worcester", "Springfield", "Lowell", "Newton", "Quincy", "Somerville", "Brookline", "Waltham"] },
      { code: "IL", label: "Illinois", cities: ["Chicago", "Aurora", "Naperville", "Joliet", "Rockford", "Springfield", "Elgin", "Peoria", "Waukegan", "Champaign"] },
      { code: "CO", label: "Colorado", cities: ["Denver", "Aurora", "Colorado Springs", "Fort Collins", "Lakewood", "Thornton", "Arvada", "Westminster", "Boulder", "Pueblo"] },
      { code: "GA", label: "Georgia", cities: ["Atlanta", "Augusta", "Columbus", "Macon", "Savannah", "Athens", "Sandy Springs", "Roswell", "Johns Creek", "Alpharetta"] },
      { code: "NC", label: "North Carolina", cities: ["Charlotte", "Raleigh", "Greensboro", "Durham", "Winston-Salem", "Fayetteville", "Cary", "Wilmington", "High Point", "Concord"] },
    ],
  },
  CA: {
    label: "Canada",
    dialCode: "+1",
    states: [
      { code: "ON", label: "Ontario", cities: ["Toronto", "Ottawa", "Mississauga", "Brampton", "Hamilton", "London", "Markham", "Vaughan", "Kitchener", "Windsor"] },
      { code: "BC", label: "British Columbia", cities: ["Vancouver", "Victoria", "Surrey", "Burnaby", "Richmond", "Kelowna", "Abbotsford", "Coquitlam", "Langley", "Nanaimo"] },
      { code: "AB", label: "Alberta", cities: ["Calgary", "Edmonton", "Red Deer", "Lethbridge", "St. Albert", "Medicine Hat", "Grande Prairie", "Airdrie", "Spruce Grove", "Lloydminster"] },
      { code: "QC", label: "Quebec", cities: ["Montreal", "Quebec City", "Laval", "Gatineau", "Longueuil", "Sherbrooke", "Saguenay", "Lévis", "Trois-Rivières", "Terrebonne"] },
      { code: "MB", label: "Manitoba", cities: ["Winnipeg", "Brandon", "Steinbach", "Thompson", "Portage la Prairie", "Winkler", "Selkirk", "Morden", "Dauphin", "The Pas"] },
      { code: "SK", label: "Saskatchewan", cities: ["Saskatoon", "Regina", "Prince Albert", "Moose Jaw", "Swift Current", "Yorkton", "North Battleford", "Estevan", "Weyburn", "Lloydminster"] },
      { code: "NS", label: "Nova Scotia", cities: ["Halifax", "Cape Breton", "Truro", "New Glasgow", "Glace Bay", "Sydney", "Dartmouth", "Bridgewater", "Amherst", "Yarmouth"] },
      { code: "NB", label: "New Brunswick", cities: ["Moncton", "Saint John", "Fredericton", "Miramichi", "Dieppe", "Edmundston", "Bathurst", "Campbellton", "Oromocto", "Sussex"] },
      { code: "NL", label: "Newfoundland and Labrador", cities: ["St. John's", "Mount Pearl", "Corner Brook", "Conception Bay South", "Grand Falls-Windsor", "Paradise", "Portugal Cove", "Happy Valley-Goose Bay", "Labrador City", "Gander"] },
      { code: "PE", label: "Prince Edward Island", cities: ["Charlottetown", "Summerside", "Stratford", "Cornwall", "Montague", "Kensington", "Souris", "Alberton", "O'Leary", "Tignish"] },
    ],
  },
  GB: {
    label: "United Kingdom",
    dialCode: "+44",
    states: [
      { code: "ENG", label: "England", cities: ["London", "Manchester", "Birmingham", "Leeds", "Liverpool", "Bristol", "Sheffield", "Nottingham", "Leicester", "Newcastle"] },
      { code: "SCT", label: "Scotland", cities: ["Edinburgh", "Glasgow", "Aberdeen", "Dundee", "Inverness", "Perth", "Stirling", "Falkirk", "Motherwell", "Paisley"] },
      { code: "WLS", label: "Wales", cities: ["Cardiff", "Swansea", "Newport", "Bangor", "St Asaph", "St Davids", "Wrexham", "Barry", "Neath", "Merthyr Tydfil"] },
      { code: "NIR", label: "Northern Ireland", cities: ["Belfast", "Derry", "Armagh", "Lisburn", "Newry", "Omagh", "Ballymena", "Antrim", "Dungannon", "Enniskillen"] },
    ],
  },
  AU: {
    label: "Australia",
    dialCode: "+61",
    states: [
      { code: "NSW", label: "New South Wales", cities: ["Sydney", "Newcastle", "Wollongong", "Central Coast", "Parramatta", "Penrith", "Blacktown", "Canberra", "Albury", "Wagga Wagga"] },
      { code: "VIC", label: "Victoria", cities: ["Melbourne", "Geelong", "Ballarat", "Bendigo", "Shepparton", "Mildura", "Wodonga", "Warrnambool", "Traralgon", "Frankston"] },
      { code: "QLD", label: "Queensland", cities: ["Brisbane", "Gold Coast", "Sunshine Coast", "Townsville", "Cairns", "Ipswich", "Toowoomba", "Mackay", "Rockhampton", "Bundaberg"] },
      { code: "WA", label: "Western Australia", cities: ["Perth", "Fremantle", "Mandurah", "Bunbury", "Geraldton", "Kalgoorlie", "Busselton", "Albany", "Broome", "Exmouth"] },
      { code: "SA", label: "South Australia", cities: ["Adelaide", "Mount Gambier", "Whyalla", "Murray Bridge", "Port Augusta", "Port Pirie", "Victor Harbor", "Gawler", "Port Lincoln", "Kadina"] },
      { code: "TAS", label: "Tasmania", cities: ["Hobart", "Launceston", "Devonport", "Burnie", "Ulverstone", "Queenstown", "George Town", "Smithton", "Wynyard", "New Norfolk"] },
      { code: "ACT", label: "Australian Capital Territory", cities: ["Canberra", "Belconnen", "Tuggeranong", "Gungahlin", "Woden", "Weston Creek", "Molonglo Valley", "Jerrabomberra", "Queanbeyan", "Hall"] },
      { code: "NT", label: "Northern Territory", cities: ["Darwin", "Alice Springs", "Palmerston", "Katherine", "Nhulunbuy", "Tennant Creek", "Alyangula", "Jabiru", "Yulara", "Humpty Doo"] },
    ],
  },
  SG: {
    label: "Singapore",
    dialCode: "+65",
    states: [
      {
        code: "SG",
        label: "Singapore",
        cities: ["Central Region", "East Region", "North Region", "North-East Region", "West Region"],
      },
    ],
  },
  HK: {
    label: "Hong Kong",
    dialCode: "+852",
    states: [
      { code: "HKI", label: "Hong Kong Island", cities: ["Central and Western", "Eastern", "Southern", "Wan Chai", "Aberdeen"] },
      { code: "KLN", label: "Kowloon", cities: ["Kowloon City", "Kwun Tong", "Sham Shui Po", "Wong Tai Sin", "Yau Tsim Mong"] },
      { code: "NT", label: "New Territories", cities: ["Islands", "Kwai Tsing", "North", "Sai Kung", "Sha Tin"] },
    ],
  },
  IN: {
    label: "India",
    dialCode: "+91",
    states: [
      { code: "MH", label: "Maharashtra", cities: ["Mumbai", "Pune", "Nagpur", "Nashik", "Aurangabad", "Solapur", "Thane", "Kolhapur", "Amravati", "Nanded"] },
      { code: "KA", label: "Karnataka", cities: ["Bengaluru", "Mysuru", "Hubballi", "Mangaluru", "Belagavi", "Kalaburagi", "Davanagere", "Ballari", "Vijayapura", "Shivamogga"] },
      { code: "TN", label: "Tamil Nadu", cities: ["Chennai", "Coimbatore", "Madurai", "Tiruchirappalli", "Salem", "Tirunelveli", "Erode", "Vellore", "Thoothukudi", "Dindigul"] },
      { code: "DL", label: "Delhi", cities: ["New Delhi", "Central Delhi", "East Delhi", "North Delhi", "South Delhi", "West Delhi", "North East Delhi", "Dwarka", "Rohini", "Noida (Border)"] },
      { code: "GJ", label: "Gujarat", cities: ["Ahmedabad", "Surat", "Vadodara", "Rajkot", "Bhavnagar", "Jamnagar", "Junagadh", "Gandhinagar", "Anand", "Nadiad"] },
      { code: "TS", label: "Telangana", cities: ["Hyderabad", "Warangal", "Karimnagar", "Nizamabad", "Khammam", "Ramagundam", "Secunderabad", "Mahbubnagar", "Adilabad", "Kothagudem"] },
      { code: "RJ", label: "Rajasthan", cities: ["Jaipur", "Jodhpur", "Udaipur", "Ajmer", "Bikaner", "Kota", "Bharatpur", "Alwar", "Sikar", "Pali"] },
      { code: "UP", label: "Uttar Pradesh", cities: ["Lucknow", "Kanpur", "Varanasi", "Agra", "Allahabad", "Ghaziabad", "Meerut", "Noida", "Bareilly", "Aligarh"] },
      { code: "WB", label: "West Bengal", cities: ["Kolkata", "Howrah", "Durgapur", "Asansol", "Siliguri", "Bardhaman", "Malda", "Barasat", "Krishnanagar", "Haldia"] },
      { code: "KL", label: "Kerala", cities: ["Thiruvananthapuram", "Kochi", "Kozhikode", "Thrissur", "Kollam", "Kannur", "Kottayam", "Alappuzha", "Palakkad", "Malappuram"] },
    ],
  },
  JP: {
    label: "Japan",
    dialCode: "+81",
    states: [
      { code: "TKY", label: "Tokyo", cities: ["Shinjuku", "Shibuya", "Minato", "Chiyoda", "Chuo", "Sumida", "Koto", "Shinagawa", "Meguro", "Setagaya"] },
      { code: "OSK", label: "Osaka", cities: ["Osaka City", "Sakai", "Higashiosaka", "Hirakata", "Toyonaka", "Suita", "Takatsuki", "Neyagawa", "Ikeda", "Yao"] },
      { code: "KNG", label: "Kanagawa", cities: ["Yokohama", "Kawasaki", "Sagamihara", "Fujisawa", "Odawara", "Chigasaki", "Atsugi", "Hiratsuka", "Zama", "Yamato"] },
      { code: "AIC", label: "Aichi", cities: ["Nagoya", "Toyota", "Okazaki", "Kasugai", "Toyohashi", "Anjyo", "Ichinomiya", "Seto", "Nishio", "Komaki"] },
      { code: "HYG", label: "Hyogo", cities: ["Kobe", "Himeji", "Nishinomiya", "Amagasaki", "Akashi", "Takarazuka", "Kakogawa", "Itami", "Ono", "Sanda"] },
      { code: "FKO", label: "Fukuoka", cities: ["Fukuoka City", "Kitakyushu", "Kurume", "Omuta", "Iizuka", "Nogata", "Yukuhashi", "Munakata", "Dazaifu", "Kasuga"] },
      { code: "HKD", label: "Hokkaido", cities: ["Sapporo", "Asahikawa", "Hakodate", "Kushiro", "Obihiro", "Muroran", "Otaru", "Kitami", "Tomakomai", "Iwamizawa"] },
      { code: "KYT", label: "Kyoto", cities: ["Kyoto City", "Uji", "Kameoka", "Joyo", "Nagaokakyo", "Maizuru", "Kyotanabe", "Fukuchiyama", "Muko", "Ayabe"] },
      { code: "CHB", label: "Chiba", cities: ["Chiba City", "Funabashi", "Matsudo", "Ichikawa", "Kashiwa", "Urayasu", "Nagareyama", "Narashino", "Yachiyo", "Noda"] },
      { code: "SZK", label: "Shizuoka", cities: ["Shizuoka City", "Hamamatsu", "Numazu", "Fuji", "Mishima", "Fujinomiya", "Ito", "Shimada", "Fukuroi", "Kakegawa"] },
    ],
  },
};

/**
 * Get the dial code for a given country code.
 * Falls back to looking in REGIONS first, then returns undefined.
 */
export function getDialCodeForCountry(countryCode: string): string | undefined {
  return REGIONS[countryCode]?.dialCode;
}
