import { useControlledModal } from "@/hooks/useControlledPopup";
import { Button } from "antd";
import styles from './index.module.scss';



function Home() {

  const [openModal, modalNode] = useControlledModal();
  const handleClick = () => {
    openModal({
      title: "test",
      children: <div>test</div>,
    });
  };

  return (
    <div className={styles.container}>
      <Button onClick={handleClick}>test</Button>
      {modalNode}
    </div>
  );
}

export default Home;