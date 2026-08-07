import { useControlledModal } from "@/hooks/useControlledPopup";
import { Button } from "antd";
import { log } from "@/utils/Logger";
import styles from './index.module.scss';



function Home() {

  const [openModal, modalNode] = useControlledModal();
  const handleClick = () => {
    const data = { name: 'jack' };
    log(['a1', data]);
    log(['a2|test', data]);
    log(['a3', 'test', data]);
    // openModal({
    //   title: "test",
    //   children: <div>test</div>,
    // });
  };

  return (
    <div className={styles.container}>
      <Button onClick={handleClick}>test</Button>
      {modalNode}
    </div>
  );
}

export default Home;