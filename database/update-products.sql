USE risha_pet_supplies;

UPDATE products SET brand = CASE id
  WHEN 1 THEN 'AOZI Pet Food'
  WHEN 2 THEN 'AOZI Pet Food'
  WHEN 3 THEN 'AOZI Pet Food'
  WHEN 4 THEN 'AOZI Pet Food'
  WHEN 5 THEN 'BeefPro'
  WHEN 6 THEN 'BeefPro'
  WHEN 7 THEN 'BeefPro'
  WHEN 8 THEN 'Pedigree'
  WHEN 9 THEN 'Pedigree'
  WHEN 10 THEN 'Pedigree'
  WHEN 11 THEN 'Special Dog'
  WHEN 12 THEN 'Special Dog'
  WHEN 13 THEN 'Top Breed'
  WHEN 14 THEN 'Top Breed'
  WHEN 15 THEN 'Vitality'
  WHEN 16 THEN 'Vitality'
  WHEN 17 THEN 'Zoi Pets'
  WHEN 18 THEN 'ToeiPet'
  WHEN 19 THEN 'YumYum'
  WHEN 20 THEN 'Whoopy'
  WHEN 21 THEN 'GoodBoy'
  WHEN 22 THEN 'Holistic Pet'
  WHEN 23 THEN 'Holistic Pet'
  WHEN 24 THEN 'NutriChunks'
  WHEN 25 THEN 'AOZI Pet Food'
  WHEN 26 THEN 'AOZI Pet Food'
  WHEN 27 THEN 'Cuties Pet'
  WHEN 28 THEN 'PowerCat'
  WHEN 29 THEN 'PowerCat'
  WHEN 30 THEN 'Special Cat'
  WHEN 31 THEN 'ToeiPet'
  WHEN 32 THEN 'Special Cat'
  WHEN 33 THEN 'Whiskas'
  WHEN 34 THEN 'Whiskas'
  WHEN 35 THEN 'Zoi Pets'
  WHEN 36 THEN 'Infinity Pets'
  WHEN 37 THEN 'Infinity Pets'
  WHEN 38 THEN 'Monello'
  WHEN 39 THEN 'Monello'
  WHEN 40 THEN 'SmartHeart'
  WHEN 41 THEN 'PetYum'
  WHEN 42 THEN 'PetMara'
  WHEN 43 THEN 'Reflex'
  WHEN 44 THEN 'AOZI Pet Food'
  WHEN 45 THEN 'Pedigree'
  WHEN 46 THEN 'Pedigree'
  WHEN 47 THEN 'Pedigree'
  WHEN 48 THEN 'Special Dog'
  WHEN 49 THEN 'Royal Canin'
  WHEN 50 THEN 'AOZI Pet Food'
  WHEN 51 THEN 'Special Cat'
  WHEN 52 THEN 'Whiskas'
  WHEN 53 THEN 'Whiskas'
  WHEN 54 THEN 'Whiskas'
  WHEN 55 THEN 'KiteKat'
  WHEN 56 THEN 'KiteKat'
  WHEN 57 THEN 'Pedigree'
  WHEN 58 THEN 'Doggie Biscuit'
  WHEN 59 THEN 'Doggie Biscuit'
  WHEN 60 THEN 'JerHigh'
  WHEN 61 THEN 'Schmackos'
  WHEN 62 THEN 'VetMed'
  WHEN 63 THEN 'Cosi Pet'
  WHEN 64 THEN 'GoatPro'
  WHEN 65 THEN 'GoatPro'
  WHEN 66 THEN 'VetMed'
  WHEN 67 THEN 'VetMed'
  WHEN 68 THEN 'VetMed'
  WHEN 69 THEN 'VetMed'
  WHEN 70 THEN 'VetMed'
  WHEN 71 THEN 'VetMed'
  WHEN 72 THEN 'VetMed'
  WHEN 73 THEN 'VetMed'
  WHEN 74 THEN 'NexGard'
  WHEN 75 THEN 'NexGard'
  WHEN 76 THEN 'NexGard'
  WHEN 77 THEN 'NexGard'
  WHEN 78 THEN 'Spectra'
  WHEN 79 THEN 'Spectra'
  WHEN 80 THEN 'Spectra'
  WHEN 81 THEN 'Spectra'
  WHEN 82 THEN 'Spectra'
  WHEN 83 THEN 'VetMed'
  WHEN 84 THEN 'VetMed'
  WHEN 85 THEN 'DextroVet'
  WHEN 86 THEN 'DextroVet'
  WHEN 87 THEN 'Mondex'
  WHEN 88 THEN 'Mondex'
  WHEN 89 THEN 'VetMed'
  WHEN 90 THEN 'Papi Pet'
  WHEN 91 THEN 'Papi Pet'
  WHEN 92 THEN 'Papi Pet'
  WHEN 93 THEN 'Papi Pet'
  WHEN 94 THEN 'Papi Pet'
  WHEN 95 THEN 'Energy Pet'
  WHEN 96 THEN 'PuppyLove'
  WHEN 97 THEN 'PuppyLove'
  WHEN 98 THEN 'PetAg'
  WHEN 99 THEN 'Cosi Pet'
  WHEN 100 THEN 'Bearing'
  WHEN 101 THEN 'Bearing'
  WHEN 102 THEN 'Bearing'
  WHEN 103 THEN 'VetCore'
  WHEN 104 THEN 'MDC'
  WHEN 105 THEN 'MDC'
  WHEN 106 THEN 'Prolific Tails'
  WHEN 107 THEN 'Prolific Tails'
  WHEN 108 THEN 'Prolific Tails'
  WHEN 109 THEN 'St. Roche'
  WHEN 110 THEN 'VetNoderm'
  WHEN 111 THEN 'Doggies Choice'
  WHEN 112 THEN 'FurMagic'
  WHEN 113 THEN 'Sevin'
  WHEN 114 THEN 'Bayopet'
  WHEN 115 THEN 'Bayopet'
  WHEN 116 THEN 'Lori'
  WHEN 117 THEN 'Feline Fresh'
  WHEN 118 THEN 'Feline Fresh'
  WHEN 119 THEN 'Chloe'
  WHEN 120 THEN 'Chloe'
END;

UPDATE products SET description = CASE id
  WHEN 1 THEN 'Premium complete dry dog food with gold standard nutrition for adult dogs.'
  WHEN 2 THEN 'Lamb-based dry dog food for adult dogs with sensitive stomachs.'
  WHEN 3 THEN 'Lamb formula specially formulated for growing puppies.'
  WHEN 4 THEN 'Premium silver formula dry food for puppies with balanced nutrition.'
  WHEN 5 THEN 'High-protein dry dog food for active adult dogs.'
  WHEN 6 THEN 'Specially formulated dry food for growing puppies with beef protein.'
  WHEN 7 THEN 'Beef teriyaki flavored dry dog food for small breeds.'
  WHEN 8 THEN 'Trusted complete nutrition dry dog food for adult dogs.'
  WHEN 9 THEN 'Small kibble formula for miniature breed adult dogs.'
  WHEN 10 THEN 'Complete nutrition dry food for growing puppies.'
  WHEN 11 THEN 'Balanced nutrition dry dog food for adult dogs of all breeds.'
  WHEN 12 THEN 'Specially formulated dry food for puppy growth and development.'
  WHEN 13 THEN 'Complete dry dog food for adult dogs with premium ingredients.'
  WHEN 14 THEN 'Nutrient-rich dry food formula for growing puppies.'
  WHEN 15 THEN 'Energy-rich dry dog food for active adult dogs.'
  WHEN 16 THEN 'High-protein dry food formula for active growing puppies.'
  WHEN 17 THEN 'Complete daily nutrition dry dog food for adult dogs.'
  WHEN 18 THEN 'Balanced dry dog food formula for adult dogs.'
  WHEN 19 THEN 'Adult dog dry food with quality ingredients for daily nutrition.'
  WHEN 20 THEN 'Premium adult dog food for maintenance and vitality.'
  WHEN 21 THEN 'Adult dry dog food for everyday health and wellness.'
  WHEN 22 THEN 'Holistic dry dog food with natural ingredients for adult dogs.'
  WHEN 23 THEN 'Holistic puppy formula with DHA for brain development.'
  WHEN 24 THEN 'Adult dog food with real chicken and grains in 10kg pack.'
  WHEN 25 THEN 'Complete dry cat food for adult cats with quality protein.'
  WHEN 26 THEN 'Kitten formula dry food with DHA for healthy development.'
  WHEN 27 THEN 'Premium dry cat food for indoor adult cats.'
  WHEN 28 THEN 'High-protein dry cat food for active adult cats.'
  WHEN 29 THEN 'Kitten dry food formula for healthy growth.'
  WHEN 30 THEN 'Complete dry cat food for daily nutrition needs.'
  WHEN 31 THEN 'Premium dry cat food with balanced nutrition for adult cats.'
  WHEN 32 THEN 'Urinary health formula dry cat food for adult cats.'
  WHEN 33 THEN 'Popular dry cat food with complete nutrition for adult cats.'
  WHEN 34 THEN 'Kitten formula dry food with balanced nutrition.'
  WHEN 35 THEN 'Complete dry cat food for indoor and outdoor adult cats.'
  WHEN 36 THEN 'Salmon-based dry cat food for skin and coat health.'
  WHEN 37 THEN 'Ocean fish dry cat food with omega fatty acids.'
  WHEN 38 THEN 'Adult cat food with quality ingredients in 7kg pack.'
  WHEN 39 THEN 'Value pack dry cat food for multiple cats in 15kg.'
  WHEN 40 THEN 'SmartHeart 15kg value pack dry cat food.'
  WHEN 41 THEN 'Complete dry cat food for daily nutrition needs.'
  WHEN 42 THEN 'Beef and chicken adult cat food with premium protein.'
  WHEN 43 THEN 'Urinary care dry cat food for adult cats.'
  WHEN 44 THEN 'Canned wet dog food with complete nutrition for adult dogs.'
  WHEN 45 THEN 'Pedigree wet dog food in can for adult dogs.'
  WHEN 46 THEN 'Pedigree pouch wet food for puppies, soft and tasty.'
  WHEN 47 THEN 'Pedigree pouch wet food for adult dogs.'
  WHEN 48 THEN 'Special Dog canned wet food for adult dogs.'
  WHEN 49 THEN 'Recovery formula wet food for sick or recovering dogs.'
  WHEN 50 THEN 'Canned wet food for adult cats from AOZI.'
  WHEN 51 THEN 'Special Cat canned wet food for daily feeding.'
  WHEN 52 THEN 'Whiskas canned wet food for adult cats.'
  WHEN 53 THEN 'Whiskas pouch wet food for adult cats.'
  WHEN 54 THEN 'Whiskas kitten pouch wet food for growing kittens.'
  WHEN 55 THEN 'KiteKat kitten pouch, soft food for kittens.'
  WHEN 56 THEN 'KiteKat adult pouch wet cat food.'
  WHEN 57 THEN 'Dentastix puppy pack 7 sticks for dental health.'
  WHEN 58 THEN 'Small doggie biscuits, crunchy treat for dogs.'
  WHEN 59 THEN 'Small milky biscuits, tasty treat for all dogs.'
  WHEN 60 THEN 'JerHigh meat treats for dogs, high-quality protein.'
  WHEN 61 THEN 'Schmackos meat jerky, a favorite dog treat.'
  WHEN 62 THEN 'SMP supplement box for general pet health maintenance.'
  WHEN 63 THEN 'Cosi milk supplement for newborn puppies and kittens.'
  WHEN 64 THEN 'Goats milk powder 100g for puppies and kittens.'
  WHEN 65 THEN 'Goats milk powder 200g for young animals.'
  WHEN 66 THEN 'Iozin supplement for skin and coat health in pets.'
  WHEN 67 THEN 'LCVit large multivitamin supplement for pets.'
  WHEN 68 THEN 'LCVit small multivitamin for small pets.'
  WHEN 69 THEN 'Renacure kidney support supplement for pets.'
  WHEN 70 THEN 'Nematocide 15ml dewormer for puppies and kittens.'
  WHEN 71 THEN 'Nacalvit-C calcium and vitamin C supplement.'
  WHEN 72 THEN 'Detick 1cc tick and flea treatment for small pets.'
  WHEN 73 THEN 'Detick 2cc tick and flea treatment for medium pets.'
  WHEN 74 THEN 'NexGard flea and tick chew for dogs 2-4kg.'
  WHEN 75 THEN 'NexGard flea and tick chew for dogs 4-10kg.'
  WHEN 76 THEN 'NexGard flea and tick chew for dogs 10-25kg.'
  WHEN 77 THEN 'NexGard flea and tick chew for dogs 25-50kg.'
  WHEN 78 THEN 'Spectra broad-spectrum dewormer for dogs 2-3.5kg.'
  WHEN 79 THEN 'Spectra dewormer for dogs 3.5-7.5kg.'
  WHEN 80 THEN 'Spectra dewormer for dogs 7.5-15kg.'
  WHEN 81 THEN 'Spectra dewormer for dogs 15-30kg.'
  WHEN 82 THEN 'Spectra dewormer for dogs 30-60kg.'
  WHEN 83 THEN 'Enmalac milk supplement for newborn animals.'
  WHEN 84 THEN 'Mycocide antifungal solution for pets.'
  WHEN 85 THEN 'Dextrovet dextrose powder 100g energy supplement.'
  WHEN 86 THEN 'Dextrose powder 300g for energy and hydration.'
  WHEN 87 THEN 'Mondex small 100g multivitamin-mineral supplement.'
  WHEN 88 THEN 'Mondex large 340g multivitamin-mineral supplement.'
  WHEN 89 THEN 'Broncure respiratory support supplement for pets.'
  WHEN 90 THEN 'Papi Doxy antibiotic treatment for infections.'
  WHEN 91 THEN 'Papi Scour treatment for diarrhea in pets.'
  WHEN 92 THEN 'Papi MVP multivitamin paste for pets.'
  WHEN 93 THEN 'Papi OB obstetric supplement for pregnant pets.'
  WHEN 94 THEN 'Papi Bion biotin supplement for skin and coat.'
  WHEN 95 THEN 'Ener-G energy supplement for weak or recovering pets.'
  WHEN 96 THEN 'PuppyLove 1.8kg milk replacer for newborn puppies.'
  WHEN 97 THEN 'PuppyLove small milk replacer for toy breed puppies.'
  WHEN 98 THEN 'Pets Own Milk lactose-free milk for cats.'
  WHEN 99 THEN 'Cosi milk replacer for kittens and puppies.'
  WHEN 100 THEN 'Bearing small shampoo for dogs and cats.'
  WHEN 101 THEN 'Bearing shampoo 300ml for regular pet grooming.'
  WHEN 102 THEN 'Bearing pet soap bar for gentle cleaning.'
  WHEN 103 THEN 'VetCore medicated soap for skin conditions.'
  WHEN 104 THEN 'MDC soap bar for basic pet hygiene.'
  WHEN 105 THEN 'MDC shampoo 100ml for gentle daily cleaning.'
  WHEN 106 THEN 'Prolific Tails shampoo 1 gallon bulk size.'
  WHEN 107 THEN 'Prolific Tails shampoo half gallon size.'
  WHEN 108 THEN 'Prolific Tails MDC shampoo 500ml.'
  WHEN 109 THEN 'St. Roche premium shampoo for show-quality coat.'
  WHEN 110 THEN 'VetNoderm medicated soap for skin issues.'
  WHEN 111 THEN 'Doggies Choice shampoo 250ml for dogs.'
  WHEN 112 THEN 'FurMagic small coat conditioner for pets.'
  WHEN 113 THEN 'Sevin powder small for flea and tick control.'
  WHEN 114 THEN 'Bayopet soap for sensitive pet skin.'
  WHEN 115 THEN 'Bayopet medicated powder for skin conditions.'
  WHEN 116 THEN 'Lori soap bar for dog and cat grooming.'
  WHEN 117 THEN 'Feline Fresh 5L clumping cat litter.'
  WHEN 118 THEN 'Feline Fresh 10L clumping cat litter value pack.'
  WHEN 119 THEN 'Chloe 10L cat litter with odor control.'
  WHEN 120 THEN 'Chloe 5L cat litter for single cat households.'
END;

UPDATE products SET species = CASE id
  WHEN 1 THEN 'Dog'
  WHEN 2 THEN 'Dog'
  WHEN 3 THEN 'Dog'
  WHEN 4 THEN 'Dog'
  WHEN 5 THEN 'Dog'
  WHEN 6 THEN 'Dog'
  WHEN 7 THEN 'Dog'
  WHEN 8 THEN 'Dog'
  WHEN 9 THEN 'Dog'
  WHEN 10 THEN 'Dog'
  WHEN 11 THEN 'Dog'
  WHEN 12 THEN 'Dog'
  WHEN 13 THEN 'Dog'
  WHEN 14 THEN 'Dog'
  WHEN 15 THEN 'Dog'
  WHEN 16 THEN 'Dog'
  WHEN 17 THEN 'Dog'
  WHEN 18 THEN 'Dog'
  WHEN 19 THEN 'Dog'
  WHEN 20 THEN 'Dog'
  WHEN 21 THEN 'Dog'
  WHEN 22 THEN 'Dog'
  WHEN 23 THEN 'Dog'
  WHEN 24 THEN 'Dog'
  WHEN 25 THEN 'Cat'
  WHEN 26 THEN 'Cat'
  WHEN 27 THEN 'Cat'
  WHEN 28 THEN 'Cat'
  WHEN 29 THEN 'Cat'
  WHEN 30 THEN 'Cat'
  WHEN 31 THEN 'Cat'
  WHEN 32 THEN 'Cat'
  WHEN 33 THEN 'Cat'
  WHEN 34 THEN 'Cat'
  WHEN 35 THEN 'Cat'
  WHEN 36 THEN 'Cat'
  WHEN 37 THEN 'Cat'
  WHEN 38 THEN 'Cat'
  WHEN 39 THEN 'Cat'
  WHEN 40 THEN 'Cat'
  WHEN 41 THEN 'Cat'
  WHEN 42 THEN 'Cat'
  WHEN 43 THEN 'Cat'
  WHEN 44 THEN 'Dog'
  WHEN 45 THEN 'Dog'
  WHEN 46 THEN 'Dog'
  WHEN 47 THEN 'Dog'
  WHEN 48 THEN 'Dog'
  WHEN 49 THEN 'Dog'
  WHEN 50 THEN 'Cat'
  WHEN 51 THEN 'Cat'
  WHEN 52 THEN 'Cat'
  WHEN 53 THEN 'Cat'
  WHEN 54 THEN 'Cat'
  WHEN 55 THEN 'Cat'
  WHEN 56 THEN 'Cat'
  WHEN 57 THEN 'Dog'
  WHEN 58 THEN 'Dog'
  WHEN 59 THEN 'Dog'
  WHEN 60 THEN 'Dog'
  WHEN 61 THEN 'Dog'
  WHEN 74 THEN 'Dog'
  WHEN 75 THEN 'Dog'
  WHEN 76 THEN 'Dog'
  WHEN 77 THEN 'Dog'
  WHEN 78 THEN 'Dog'
  WHEN 79 THEN 'Dog'
  WHEN 80 THEN 'Dog'
  WHEN 81 THEN 'Dog'
  WHEN 82 THEN 'Dog'
  WHEN 96 THEN 'Dog'
  WHEN 97 THEN 'Dog'
  WHEN 117 THEN 'Cat'
  WHEN 118 THEN 'Cat'
  WHEN 119 THEN 'Cat'
  WHEN 120 THEN 'Cat'
END;

UPDATE products SET stock_quantity = CASE id
  WHEN 1 THEN 3
  WHEN 2 THEN 12
  WHEN 3 THEN 5
  WHEN 4 THEN 18
  WHEN 5 THEN 12
  WHEN 6 THEN 5
  WHEN 7 THEN 3
  WHEN 8 THEN 18
  WHEN 9 THEN 0
  WHEN 10 THEN 0
  WHEN 11 THEN 15
  WHEN 12 THEN 15
  WHEN 13 THEN 3
  WHEN 14 THEN 8
  WHEN 15 THEN 8
  WHEN 16 THEN 15
  WHEN 17 THEN 0
  WHEN 18 THEN 15
  WHEN 19 THEN 10
  WHEN 20 THEN 8
  WHEN 21 THEN 3
  WHEN 22 THEN 18
  WHEN 23 THEN 5
  WHEN 24 THEN 2
  WHEN 25 THEN 18
  WHEN 26 THEN 5
  WHEN 27 THEN 3
  WHEN 28 THEN 15
  WHEN 29 THEN 20
  WHEN 30 THEN 5
  WHEN 31 THEN 3
  WHEN 32 THEN 5
  WHEN 33 THEN 25
  WHEN 34 THEN 8
  WHEN 35 THEN 8
  WHEN 36 THEN 3
  WHEN 37 THEN 12
  WHEN 38 THEN 18
  WHEN 39 THEN 2
  WHEN 40 THEN 20
  WHEN 41 THEN 12
  WHEN 42 THEN 20
  WHEN 43 THEN 3
  WHEN 44 THEN 48
  WHEN 45 THEN 60
  WHEN 46 THEN 72
  WHEN 47 THEN 36
  WHEN 48 THEN 60
  WHEN 49 THEN 6
  WHEN 50 THEN 0
  WHEN 51 THEN 0
  WHEN 52 THEN 72
  WHEN 53 THEN 0
  WHEN 54 THEN 60
  WHEN 55 THEN 6
  WHEN 56 THEN 24
  WHEN 57 THEN 10
  WHEN 58 THEN 60
  WHEN 59 THEN 40
  WHEN 60 THEN 20
  WHEN 61 THEN 50
  WHEN 62 THEN 15
  WHEN 63 THEN 0
  WHEN 64 THEN 18
  WHEN 65 THEN 5
  WHEN 66 THEN 20
  WHEN 67 THEN 18
  WHEN 68 THEN 25
  WHEN 69 THEN 15
  WHEN 70 THEN 2
  WHEN 71 THEN 10
  WHEN 72 THEN 25
  WHEN 73 THEN 5
  WHEN 74 THEN 30
  WHEN 75 THEN 15
  WHEN 76 THEN 2
  WHEN 77 THEN 15
  WHEN 78 THEN 10
  WHEN 79 THEN 18
  WHEN 80 THEN 0
  WHEN 81 THEN 0
  WHEN 82 THEN 2
  WHEN 83 THEN 30
  WHEN 84 THEN 12
  WHEN 85 THEN 20
  WHEN 86 THEN 30
  WHEN 87 THEN 10
  WHEN 88 THEN 0
  WHEN 89 THEN 20
  WHEN 90 THEN 8
  WHEN 91 THEN 8
  WHEN 92 THEN 0
  WHEN 93 THEN 20
  WHEN 94 THEN 18
  WHEN 95 THEN 20
  WHEN 96 THEN 2
  WHEN 97 THEN 2
  WHEN 98 THEN 8
  WHEN 99 THEN 20
  WHEN 100 THEN 10
  WHEN 101 THEN 3
  WHEN 102 THEN 12
  WHEN 103 THEN 15
  WHEN 104 THEN 12
  WHEN 105 THEN 18
  WHEN 106 THEN 18
  WHEN 107 THEN 3
  WHEN 108 THEN 5
  WHEN 109 THEN 25
  WHEN 110 THEN 5
  WHEN 111 THEN 0
  WHEN 112 THEN 15
  WHEN 113 THEN 5
  WHEN 114 THEN 5
  WHEN 115 THEN 18
  WHEN 116 THEN 3
  WHEN 117 THEN 0
  WHEN 118 THEN 5
  WHEN 119 THEN 0
  WHEN 120 THEN 2
END;

UPDATE products SET batch_number = CASE id
  WHEN 42 THEN 'BATCH-8391'
  WHEN 34 THEN 'BATCH-5977'
  WHEN 61 THEN 'BATCH-8028'
  WHEN 5 THEN 'BATCH-1462'
  WHEN 97 THEN 'BATCH-3598'
  WHEN 72 THEN 'BATCH-9545'
  WHEN 43 THEN 'BATCH-6322'
  WHEN 54 THEN 'BATCH-9467'
  WHEN 45 THEN 'BATCH-9433'
  WHEN 4 THEN 'BATCH-3250'
  WHEN 82 THEN 'BATCH-6629'
  WHEN 110 THEN 'BATCH-9194'
  WHEN 21 THEN 'BATCH-2716'
  WHEN 113 THEN 'BATCH-9936'
  WHEN 9 THEN 'BATCH-7045'
  WHEN 92 THEN 'BATCH-4684'
  WHEN 87 THEN 'BATCH-6571'
  WHEN 19 THEN 'BATCH-2521'
  WHEN 48 THEN 'BATCH-5452'
  WHEN 86 THEN 'BATCH-9295'
  WHEN 31 THEN 'BATCH-4985'
  WHEN 96 THEN 'BATCH-4330'
  WHEN 11 THEN 'BATCH-6276'
  WHEN 81 THEN 'BATCH-5334'
  WHEN 8 THEN 'BATCH-7523'
  WHEN 67 THEN 'BATCH-1704'
  WHEN 50 THEN 'BATCH-9200'
  WHEN 69 THEN 'BATCH-2316'
  WHEN 40 THEN 'BATCH-4229'
  WHEN 103 THEN 'BATCH-9276'
  WHEN 84 THEN 'BATCH-4268'
  WHEN 38 THEN 'BATCH-1281'
  WHEN 94 THEN 'BATCH-4181'
  WHEN 102 THEN 'BATCH-5395'
  WHEN 17 THEN 'BATCH-4783'
  WHEN 93 THEN 'BATCH-2394'
  WHEN 44 THEN 'BATCH-6194'
  WHEN 95 THEN 'BATCH-2372'
  WHEN 16 THEN 'BATCH-6589'
  WHEN 116 THEN 'BATCH-9809'
  WHEN 22 THEN 'BATCH-3186'
  WHEN 76 THEN 'BATCH-9752'
  WHEN 88 THEN 'BATCH-3219'
  WHEN 56 THEN 'BATCH-8929'
  WHEN 99 THEN 'BATCH-9065'
  WHEN 18 THEN 'BATCH-7526'
  WHEN 59 THEN 'BATCH-1462'
  WHEN 3 THEN 'BATCH-5208'
  WHEN 112 THEN 'BATCH-8964'
  WHEN 58 THEN 'BATCH-6579'
END;

UPDATE products SET expiration_date = CASE id
  WHEN 51 THEN '2026-12-25'
  WHEN 118 THEN '2026-12-21'
  WHEN 29 THEN '2026-07-21'
  WHEN 108 THEN '2026-11-14'
  WHEN 65 THEN '2026-08-17'
  WHEN 17 THEN '2026-10-29'
  WHEN 79 THEN '2027-02-28'
  WHEN 82 THEN '2027-04-21'
  WHEN 1 THEN '2026-11-27'
  WHEN 102 THEN '2026-07-14'
  WHEN 111 THEN '2026-12-27'
  WHEN 77 THEN '2026-07-12'
  WHEN 78 THEN '2027-04-12'
  WHEN 64 THEN '2026-12-31'
  WHEN 44 THEN '2026-11-15'
  WHEN 90 THEN '2026-08-10'
  WHEN 75 THEN '2027-02-09'
  WHEN 16 THEN '2027-04-05'
  WHEN 89 THEN '2026-11-29'
  WHEN 7 THEN '2026-10-18'
  WHEN 47 THEN '2027-05-13'
  WHEN 59 THEN '2027-01-30'
  WHEN 100 THEN '2026-10-30'
  WHEN 86 THEN '2027-01-26'
  WHEN 54 THEN '2027-03-31'
  WHEN 41 THEN '2027-04-04'
  WHEN 46 THEN '2026-12-09'
  WHEN 28 THEN '2026-10-21'
  WHEN 58 THEN '2027-02-04'
  WHEN 106 THEN '2027-02-27'
  WHEN 25 THEN '2027-04-06'
  WHEN 24 THEN '2026-11-03'
  WHEN 49 THEN '2026-12-05'
  WHEN 8 THEN '2026-07-10'
  WHEN 96 THEN '2026-09-17'
  WHEN 88 THEN '2026-08-18'
  WHEN 116 THEN '2026-06-26'
  WHEN 34 THEN '2027-01-21'
  WHEN 23 THEN '2027-05-20'
  WHEN 72 THEN '2027-02-25'
END;
