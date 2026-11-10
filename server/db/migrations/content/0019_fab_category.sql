-- The fabrication category is called fab (the entries filed under it follow: ON UPDATE CASCADE). Left alone where a
-- fab category exists already.
UPDATE `categories` SET `name` = 'fab' WHERE `name` = 'fabrication' AND NOT EXISTS (SELECT 1 FROM `categories` WHERE `name` = 'fab');
